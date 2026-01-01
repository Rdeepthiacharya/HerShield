from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import mysql.connector
import os
from dotenv import load_dotenv
from geopy.distance import geodesic
from loguru import logger
import math
import heapq
from datetime import datetime, timedelta, timezone
from dateutil import parser
import secrets
import threading
import time
from flask_socketio import SocketIO, emit,join_room, leave_room
import logging
import socket
from pyngrok import ngrok, conf
import subprocess
import psutil


# ENV + BASIC PATHS----------------------------------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VOSK_MODEL_DIR = os.path.join(BASE_DIR, "ml", "vosk_model")

FAST2SMS_API_KEY = os.getenv("FAST2SMS_API_KEY", "")
GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY", "")
NGROK_AUTHTOKEN = os.getenv('NGROK_AUTHTOKEN')

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Store tracking sessions
tracking_sessions = {}
active_connections = {}

# DB CONNECTION----------------------------------
def get_db():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
    )   

def get_public_url():
    """Get public URL for tracking"""
    try:
        # Try ngrok first
        if NGROK_AUTHTOKEN:
            try:
                tunnels = ngrok.get_tunnels()
                # Check if tunnels list is not empty
                if tunnels and len(tunnels) > 0:
                    return tunnels[0].public_url.rstrip('/')
                else:
                    logger.warning("Ngrok tunnels list is empty")
            except Exception as ngrok_error:
                logger.warning(f"Ngrok tunnel check failed: {ngrok_error}")
        
        # Fallback methods
        try:
            # Try to get server IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            server_ip = s.getsockname()[0]
            s.close()
            
            # Check if IP is public
            if server_ip.startswith(('192.168.', '10.', '172.')):
                logger.info(f"Using local IP: {server_ip}")
                return f"http://{server_ip}:5000"
            else:
                logger.info(f"Using public IP: {server_ip}")
                return f"http://{server_ip}:5000"
                
        except Exception as ip_error:
            logger.warning(f"IP detection failed: {ip_error}")
        
        # Final fallback
        return "http://localhost:5000"
        
    except Exception as e:
        logger.error(f"get_public_url error: {e}")
        return "http://localhost:5000"


def reverse_geocode(lat, lon) -> str:
    """Use Geoapify if key available, else fallback to OSM Nominatim."""
    if not lat or not lon:
        return ""
    try:
        if GEOAPIFY_API_KEY:
            r = requests.get(
                "https://api.geoapify.com/v1/geocode/reverse",
                params={
                    "lat": lat,
                    "lon": lon,
                    "format": "json",
                    "apiKey": GEOAPIFY_API_KEY,
                },
                timeout=5,
            )
            if r.ok:
                res = r.json().get("results")
                if res and len(res) > 0:
                    return res[0].get("formatted", "")
        # fallback
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json"},
            headers={"User-Agent": "HerShield/1.0"},
            timeout=5,
        )
        if r.ok:
            return r.json().get("display_name", "")
    except Exception as e:
        logger.warning(f"Reverse geocode error: {e}")
    return ""

# Travel mode speeds (km/h)
TRAVEL_SPEEDS = {
    "walk": 4.5,
    "vehicle": 20.0  # Average speed for all vehicles
}


def send_sms(numbers, message) -> bool:
    """Send SMS via Fast2SMS."""
    if not FAST2SMS_API_KEY:
        logger.warning("FAST2SMS_API_KEY not configured")
        return False
    if not numbers:
        return False

    url = "https://www.fast2sms.com/dev/bulkV2"
    headers = {
        "authorization": FAST2SMS_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "route": "q",
        "message": message,
        "language": "english",
        "numbers": ",".join(numbers),
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=8)
        return resp.ok
    except Exception as e:
        logger.error(f"SMS sending error: {e}")
        return False

def save_sos_log(user_id, trigger_type, location, message, recipients=None, status=None):
    """Insert entry into sos_logs table. Uses existing schema with location TEXT + TIMESTAMP."""
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            """
            INSERT INTO sos_logs (user_id, trigger_type, location, message, recipients, sms_status)
            VALUES (%s, %s, %s, %s, %s, %s)
        """,
            (
                user_id,
                trigger_type,
                location,
                message,
                ",".join(recipients) if recipients else None,
                status,
            ),
        )
        db.commit()
        cursor.close()
        db.close()
    except Exception as e:
        logger.error(f"Failed to save SOS log: {e}")


def a_star_safe_path(start, end, incidents, max_time=3.0):  # Add max_time parameter
    """Optimized A* pathfinding with timeout"""
    STEP = 0.004  # ~400m
    MAX_ITERS = 500  # Reduced from 800
    start_time = time.time()
    
    def h(a, b):
        return geodesic(a, b).km

    def neighbors(n):
        lat, lng = n
        return [
            (lat + dlat, lng + dlng)
            for dlat in [-STEP, 0, STEP]
            for dlng in [-STEP, 0, STEP]
            if not (dlat == 0 and dlng == 0)
        ]

    frontier = []
    heapq.heappush(frontier, (0, start))
    came = {start: None}
    cost = {start: 0}
    
    iterations = 0

    while frontier and iterations < MAX_ITERS:
        # Check timeout every 10 iterations
        if iterations % 10 == 0 and (time.time() - start_time) > max_time:
            print(f"⏰ Pathfinding timeout after {iterations} iterations")
            break
            
        _, current = heapq.heappop(frontier)
        iterations += 1

        # If we're close enough to destination, stop
        if h(current, end) < 0.5:  # 500m from destination
            break

        for nxt in neighbors(current):
            # Skip if we've already visited too many times
            if iterations > MAX_ITERS * 0.8:
                continue
                
            d_cost = geodesic(current, nxt).km
            risk = 0

            # Only check nearby incidents (optimization)
            for inc in incidents:
                d = geodesic(nxt, (inc["lat"], inc["lng"])).km
                if d < 1.0:  # Reduced from 1.5km
                    risk += inc["severity"] / (1 + d)

            new_cost = cost[current] + d_cost + (risk * 2)  # Reduced risk multiplier

            if nxt not in cost or new_cost < cost[nxt]:
                cost[nxt] = new_cost
                heapq.heappush(frontier, (new_cost + h(nxt, end), nxt))
                came[nxt] = current

    # Reconstruct path
    if not came:
        return []

    # Find the closest node to end
    end_node = min(came.keys(), key=lambda n: h(n, end))
    path = []

    while end_node:
        path.append(end_node)
        end_node = came[end_node]
        if len(path) > 100:  # Prevent infinite loops
            break

    path = list(reversed(path))
    
    print(f"✅ Path found: {len(path)} points, {iterations} iterations, {time.time()-start_time:.2f}s")
    
    # If path is too short, return straight line
    if len(path) < 2:
        print("⚠️ Path too short, returning straight line")
        return [start, end]
    
    return path

# ==========================FLASK APP============================
app = Flask(__name__)
CORS(app)

@app.route("/")
def home():
    return jsonify({"success": True, "message": "HerShield API running"}), 200

# Initialize Flask and SocketIO
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', secrets.token_urlsafe(32))

print(f"✅ SECRET_KEY: {app.config['SECRET_KEY'][:20]}...")
print(f"✅ Ngrok Token: {'✅ Set' if NGROK_AUTHTOKEN else '❌ Missing'}")
print(f"✅ Geoapify Key: {'✅ Set' if GEOAPIFY_API_KEY else '❌ Missing'}")

socketio = SocketIO(app, cors_allowed_origins="*", logger=True, engineio_logger=True, async_mode='threading')

# Health check endpoint
@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "success": True,
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "HerShield Backend"
    }), 200

# Debug endpoint to check incidents
@app.route("/debug/incidents", methods=["GET"])
def debug_incidents():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)

        # Total count
        cursor.execute("SELECT COUNT(*) as total FROM incident_reports")
        total = cursor.fetchone()['total']

        # Recent incidents
        cursor.execute("""
            SELECT id, latitude, longitude, severity, incident_type, created_at
            FROM incident_reports
            WHERE created_at >= NOW() - INTERVAL 7 DAY
            ORDER BY created_at DESC
            LIMIT 20
        """)
        incidents = cursor.fetchall()

        cursor.close()
        db.close()

        return jsonify({
            "success": True,
            "total_incidents": total,
            "recent_incidents": incidents,
            "timestamp": datetime.now().isoformat()
        }), 200
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

# Database health check endpoint
@app.route("/health/db", methods=["GET"])
def db_health_check():
    try:
        db = get_db()
        db.ping(reconnect=True)
        db.close()
        return jsonify({
            "success": True,
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.now().isoformat()
        }), 200
    except Exception as e:
        return jsonify({
            "success": False,
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e)
        }), 500


# Cleanup thread
def cleanup_thread():
    while True:
        try:
            now = datetime.now()
            sessions_to_remove = []
            
            for session_id, session in list(tracking_sessions.items()):
                if session["expires_at"] and now > datetime.fromisoformat(session["expires_at"]):
                    sessions_to_remove.append(session_id)
                    socketio.emit('session_ended', {'session_id': session_id}, room=session_id)
            
            for session_id in sessions_to_remove:
                if session_id in tracking_sessions:
                    del tracking_sessions[session_id]
                if session_id in active_connections:
                    del active_connections[session_id]
            
            time.sleep(60)
            
        except Exception as e:
            logger.error(f"Cleanup thread error: {e}")

def run_cleanup_thread():
    """Background thread to clean up expired sessions"""
    while True:
        try:
            now = datetime.now()
            sessions_to_remove = []
            
            for session_id, session in list(tracking_sessions.items()):
                if session["expires_at"] and now > datetime.fromisoformat(session["expires_at"]):
                    sessions_to_remove.append(session_id)
                    socketio.emit('session_ended', {'session_id': session_id}, room=session_id)
            
            for session_id in sessions_to_remove:
                if session_id in tracking_sessions:
                    del tracking_sessions[session_id]
                if session_id in active_connections:
                    del active_connections[session_id]
            
            time.sleep(60)
            
        except Exception as e:
            logger.error(f"Cleanup thread error: {e}")

# Start cleanup thread
cleanup_thread = threading.Thread(target=run_cleanup_thread, daemon=True)
cleanup_thread.start()

# -------------------- AUTH -----------------------
@app.route("/signup", methods=["POST"])
def signup():
    data = request.json
    fullname = data.get("fullname")
    email = data.get("email")
    mobile = data.get("mobile_no")
    password = data.get("password")

    if not all([fullname, email, mobile, password]):
        return jsonify({"error": "All fields required"}), 400

    password_hash = generate_password_hash(password)

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO users (fullname, email_id, mobile_no, password_hash)
            VALUES (%s, %s, %s, %s)
        """,
            (fullname, email, mobile, password_hash),
        )
        db.commit()
        return jsonify({"message": "Signup success"}), 201
    except mysql.connector.IntegrityError:
        return jsonify({"error": "Email already exists"}), 400
    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({"error": "Signup failed"}), 500
    finally:
        cursor.close()
        db.close()

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE email_id=%s", (email,))
    user = cursor.fetchone()
    cursor.close()
    db.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    user.pop("password_hash", None)
    return jsonify({"message": "Login success", "user": user}), 200

@app.route("/logout", methods=["POST"])
def logout():
    return jsonify({"message": "Logout successful"}), 200

@app.route("/change_password", methods=["POST"])
def change_password():
    data = request.json
    user_id = data.get("user_id")
    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not all([user_id, old_password, new_password]):
        return jsonify({"error": "All fields required"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT id, password_hash FROM users WHERE id=%s", (user_id,))
    user = cursor.fetchone()

    if not user or not check_password_hash(user["password_hash"], old_password):
        cursor.close()
        db.close()
        return jsonify({"error": "Old password incorrect"}), 400

    new_hash = generate_password_hash(new_password)
    cursor.execute(
        "UPDATE users SET password_hash=%s WHERE id=%s", (new_hash, user_id)
    )
    db.commit()
    cursor.close()
    db.close()
    return jsonify({"message": "Password updated"}), 200

# -------------------- USER PROFILE ----------------
@app.route("/user/<email>", methods=["GET"])
def get_user(email):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT id, fullname, email_id, mobile_no, birth_date,
               address_line_1, city, state, zip_code, created_at
        FROM users WHERE email_id=%s
    """,
        (email,),
    )
    user = cursor.fetchone()
    cursor.close()
    db.close()

    if user:
        return jsonify({"success": True, "user": user}), 200
    else:
        return jsonify({"success": False, "message": "User not found"}), 404

@app.route("/update_profile", methods=["POST"])
def update_profile():
    data = request.json
    user_id = data.get("id")
    if not user_id:
        return jsonify({"error": "User ID required"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        """
        UPDATE users SET
            fullname=%s, mobile_no=%s, birth_date=%s,
            address_line_1=%s, city=%s, state=%s, zip_code=%s
        WHERE id=%s
    """,
        (
            data.get("fullname"),
            data.get("mobile_no"),
            data.get("birth_date"),
            data.get("address_line_1"),
            data.get("city"),
            data.get("state"),
            data.get("zip_code"),
            user_id,
        ),
    )
    db.commit()
    cursor.close()
    db.close()
    return jsonify({"message": "Profile updated"}), 200

@app.route("/user-stats/<int:user_id>", methods=["GET"])
def get_user_stats(user_id):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        
        # Get report count from incident_reports (not user_reports)
        cursor.execute(
            """
            SELECT COUNT(*) as reports_filed 
            FROM incident_reports 
            WHERE user_id = %s
            """,
            (user_id,)
        )
        report_data = cursor.fetchone()
        
        # Get SOS count from sos_logs
        cursor.execute(
            """
            SELECT COUNT(*) as sos_used 
            FROM sos_logs 
            WHERE user_id = %s
            """,
            (user_id,)
        )
        sos_data = cursor.fetchone()
        
        cursor.close()
        db.close()
        
        return jsonify({
            "success": True,
            "stats": {
                "reports_filed": report_data["reports_filed"] or 0,
                "sos_used": sos_data["sos_used"] or 0,
            }
        }), 200
        
    except Exception as e:
        logger.error(f"user-stats error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# -------------------- TRUSTED CONTACTS -------------
@app.route("/trusted-contacts/<int:uid>", methods=["GET"])
def get_contacts(uid):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        "SELECT * FROM trusted_contacts WHERE user_id=%s ORDER BY created_at DESC",
        (uid,),
    )
    contacts = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"contacts": contacts}), 200

@app.route("/add_contact", methods=["POST"])
def add_contact():
    data = request.json
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO trusted_contacts (user_id, contact_name, mobile_number, relationship)
            VALUES (%s, %s, %s, %s)
        """,
            (
                data["user_id"],
                data["contact_name"],
                data["mobile_number"],
                data.get("relationship", ""),
            ),
        )
        db.commit()
        new_id = cursor.lastrowid
        return jsonify({"contact_id": new_id}), 201
    except Exception as e:
        logger.error(f"Add contact error: {e}")
        return jsonify({"error": "Failed to add contact"}), 500
    finally:
        cursor.close()
        db.close()

@app.route("/remove_contact", methods=["POST"])
def remove_contact():
    data = request.json
    contact_id = data.get("contact_id")
    if not contact_id:
        return jsonify({"error": "contact_id required"}), 400

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM trusted_contacts WHERE contact_id=%s", (contact_id,))
        db.commit()
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.error(f"Remove contact error: {e}")
        return jsonify({"success": False, "error": "Failed to remove contact"}), 500
    finally:
        cursor.close()
        db.close() 

# -------------------- SOS LOGS & MANUAL SOS --------
@app.route("/sos_logs/<int:user_id>", methods=["GET"])
def get_sos_logs(user_id):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        "SELECT * FROM sos_logs WHERE user_id=%s ORDER BY TIMESTAMP DESC", (user_id,)
    )
    logs = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"logs": logs}), 200

@app.route("/trigger_sos", methods=["POST"])
def trigger_sos():
    data = request.json
    user_id = data.get("user_id")
    lat = data.get("lat")
    lon = data.get("lon")

    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT fullname FROM users WHERE id=%s", (user_id,))
    user = cursor.fetchone()
    cursor.execute(
        "SELECT contact_name, mobile_number FROM trusted_contacts WHERE user_id=%s",
        (user_id,),
    )
    contacts = cursor.fetchall()
    cursor.close()
    db.close()

    if not user or not contacts:
        return jsonify({"error": "No contacts found"}), 404

    # SIMPLE & CLEAR - Just Google Maps link
    if lat and lon:
        location_link = f"https://maps.google.com/?q={lat},{lon}"
        # Optional: Add "Open in Google Maps" text to make it clear
        location_display = f"https://maps.google.com/?q={lat},{lon}"
        location_available = True
    else:
        location_link = "Location unavailable"
        location_display = "Location unavailable"
        location_available = False

    # Clean, urgent message - ONE MAP LINK
    message = f"""
⚠️ SOS ALERT ⚠️

{user['fullname']} is in danger and needs immediate help!

📍 LOCATION:
{location_display}

🚨 Please check on them immediately.
If no response, contact local authorities.

Sent via HerShield Safety App
"""

    location_string = f"{lat},{lon}" if lat and lon else "Unknown"
    save_sos_log(user_id, "manual", location_string, message)

    return jsonify(
        {
            "success": True,
            "contacts": contacts,
            "message": message,
            "location_link": location_link,  # Google Maps link
            "coordinates": f"{lat},{lon}" if location_available else None,
        }
    ), 200



def shorten_url(long_url):
    try:
        r = requests.get("https://tinyurl.com/api-create.php?url=" + long_url)
        return r.text.strip()
    except:
        return long_url   # fallback


@app.route("/send_sos_sms", methods=["POST"])
def send_sos_sms():
    """SOS endpoint - shows live tracking link when available"""
    data = request.json
    user_id = data.get("user_id")
    lat = data.get("lat")
    lon = data.get("lon")
    auto = data.get("auto", False)
    tracking_url = data.get("tracking_url", "")
    trigger_reason = data.get("trigger_reason", "")  # Add this for auto voice

    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute("SELECT fullname FROM users WHERE id=%s", (user_id,))
    user = cursor.fetchone()

    cursor.execute(
        "SELECT mobile_number FROM trusted_contacts WHERE user_id=%s",
        (user_id,)
    )
    contacts = cursor.fetchall()

    cursor.close()
    db.close()

    if not user or not contacts:
        return jsonify({"success": False, "error": "User or contacts not found"}), 404

    recipients = [c["mobile_number"] for c in contacts]
    user_name = user["fullname"]
    
    # Get Google Maps link for fallback
    google_maps_link = ""
    if lat and lon:
        long_map_link = f"https://www.google.com/maps?q={lat},{lon}"
        google_maps_link = shorten_url(long_map_link)
        location_store = f"{lat},{lon}"
    else:
        google_maps_link = ""  # Empty if no coordinates
        location_store = "Unknown"

    # ====== AUTO VOICE MESSAGE ======
    if auto and trigger_reason:
        # Auto-triggered SOS message
        message = f"""🚨 AUTOMATIC EMERGENCY ALERT

{user_name} may be in danger!

🔍 System detected: {trigger_reason}

📍 LIVE LOCATION TRACKING:
{tracking_url if tracking_url else google_maps_link}

⚠️ This alert was automatically triggered by voice analysis.
Please check on them immediately!

Sent via HerShield Auto-SOS"""
        
    elif tracking_url:
        # WITH LIVE TRACKING - Show only this link
        message = f"""⚠️ EMERGENCY SOS ALERT 

{user_name} needs IMMEDIATE help!

📍 LIVE LOCATION TRACKING:
{tracking_url}

🚨 URGENT - Please check immediately!

Sent via HerShield App"""
        
    elif google_maps_link:
        # WITHOUT LIVE TRACKING - Show Google Maps as fallback
        message = f"""⚠️ SOS Alert

{user_name} needs help!

📍 Location:
{google_maps_link}

Please check on them immediately.

Sent via HerShield App"""
        
    else:
        # NO LOCATION AVAILABLE
        message = f"""⚠️ SOS Alert

{user_name} needs help!

📍 Location: Unavailable

Please check on them immediately.

Sent via HerShield App"""

    # Try sending SMS
    sms_ok = send_sms(recipients, message)
    
    # Save to logs
    trigger_type = "auto_voice" if auto and trigger_reason else ("auto" if auto else "manual")
    
    save_sos_log(
        user_id,
        trigger_type,
        location_store,
        message,
        recipients=recipients,
        status="delivered" if sms_ok else "failed",
    )
    
    return jsonify({
        "success": sms_ok,
        "has_live_tracking": bool(tracking_url),
        "tracking_url": tracking_url if tracking_url else None,
        "google_maps_link": google_maps_link if google_maps_link else None,
        "coordinates": location_store,
        "recipients_count": len(recipients)
    }), 200



# Debug endpoint

@app.route("/submit_report", methods=["POST"])
def submit_report():
    try:
        data = request.json
        
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        incident_type = data.get("incident_type")
        
        if not all([latitude, longitude, incident_type]):
            return jsonify({"success": False, "error": "Missing required fields"}), 400

        # Optional fields
        user_id = data.get("user_id")  # Can be NULL for anonymous
        severity = data.get("severity", 1)
        description = data.get("description", "")
        place_name = data.get("place_name", "") or reverse_geocode(latitude, longitude)
        location_type = data.get("location_type", "gps_auto")

        # Save to incident_reports ONLY
        db = get_db()
        cursor = db.cursor()

        cursor.execute(
            """
            INSERT INTO incident_reports
            (user_id, latitude, longitude, severity, incident_type, description, place_name, location_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                user_id,
                latitude,
                longitude,
                severity,
                incident_type,
                description,
                place_name,
                location_type,
            ),
        )
        incident_report_id = cursor.lastrowid

        db.commit()
        cursor.close()
        db.close()

        return jsonify(
            {
                "success": True,
                "message": "Report submitted successfully",
                "incident_report_id": incident_report_id,
            }
        ), 201
    except Exception as e:
        logger.error(f"Submit report error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# Helper function for relative time
def get_relative_time(created_at):
    """Convert datetime to relative time string like '2 days ago'"""
    if not created_at:
        return "Recently"
    
    # Parse the datetime if it's a string
    if isinstance(created_at, str):
        dt = parser.isoparse(created_at)
    else:
        dt = created_at
    
    # Make sure it's timezone aware (UTC)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    
    now = datetime.now(timezone.utc)
    diff = now - dt
    
    # Convert to seconds
    seconds = diff.total_seconds()
    
    if seconds < 60:
        return "Just now"
    elif seconds < 3600:  # Less than 1 hour
        minutes = int(seconds // 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif seconds < 86400:  # Less than 1 day
        hours = int(seconds // 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif seconds < 2592000:  # Less than 30 days
        days = int(seconds // 86400)
        if days == 1:
            return "Yesterday"
        elif days < 7:
            return f"{days} days ago"
        elif days < 14:
            return "1 week ago"
        elif days < 21:
            return "2 weeks ago"
        elif days < 28:
            return "3 weeks ago"
        else:
            return "4 weeks ago"
    elif seconds < 31536000:  # Less than 1 year
        months = int(seconds // 2592000)
        if months == 1:
            return "1 month ago"
        elif months < 12:
            return f"{months} months ago"
    else:
        years = int(seconds // 31536000)
        if years == 1:
            return "1 year ago"
        else:
            return f"{years} years ago"


# Update the /incidents/recent endpoint to include relative_time
@app.route("/incidents/recent", methods=["GET"])
def get_recent_incidents():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        
        # Get all incidents, not just recent 48 hours
        cursor.execute("""
            SELECT 
                id,
                latitude,
                longitude,
                severity,
                incident_type,
                description,
                place_name,
                location_type,
                is_verified,
                created_at,
                updated_at
            FROM incident_reports
            ORDER BY created_at DESC
            LIMIT 100  # Limit to 100 most recent incidents
        """)
        
        incidents = cursor.fetchall()
        cursor.close()
        db.close()
        
        # Format the response
        formatted_incidents = []
        for incident in incidents:
            relative_time = get_relative_time(incident["created_at"])
            
            formatted_incidents.append({
                "id": incident["id"],
                "latitude": float(incident["latitude"]),
                "longitude": float(incident["longitude"]),
                "severity": incident["severity"],
                "incident_type": incident["incident_type"],
                "description": incident["description"] or "",
                "place_name": incident["place_name"] or "",
                "location_type": incident["location_type"],
                "is_verified": bool(incident["is_verified"]),
                "created_at": incident["created_at"].isoformat() if incident["created_at"] else None,
                "relative_time": relative_time,  # Add relative time
                "updated_at": incident["updated_at"].isoformat() if incident["updated_at"] else None,
            })
        
        return jsonify({
            "success": True, 
            "incidents": formatted_incidents,
            "count": len(formatted_incidents)
        }), 200
        
    except Exception as e:
        logger.error(f"Get recent incidents error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/incident_reports/<int:user_id>", methods=["GET"])
def get_user_incident_reports(user_id):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        
        cursor.execute(
            """
            SELECT 
                ir.id,
                ir.latitude,
                ir.longitude,
                ir.severity,
                ir.incident_type,
                ir.description,
                ir.place_name,
                ir.location_type,
                ir.is_verified,
                ir.created_at,
                ir.updated_at
            FROM incident_reports ir
            WHERE ir.user_id = %s
            ORDER BY ir.created_at DESC
            """,
            (user_id,)
        )
        reports = cursor.fetchall()
        
        cursor.close()
        db.close()
        
        # Format the response
        formatted_reports = []
        for report in reports:
            relative_time = get_relative_time(report["created_at"])
            
            formatted_reports.append({
                "id": report["id"],
                "latitude": float(report["latitude"]),
                "longitude": float(report["longitude"]),
                "severity": report["severity"],
                "incident_type": report["incident_type"],
                "description": report["description"] or "",
                "place_name": report["place_name"] or "",
                "location_type": report["location_type"],
                "is_verified": bool(report["is_verified"]),
                "created_at": report["created_at"].isoformat() if report["created_at"] else None,
                "relative_time": relative_time,  # Add relative time
                "updated_at": report["updated_at"].isoformat() if report["updated_at"] else None,
            })
        
        return jsonify({
            "success": True, 
            "reports": formatted_reports,
            "count": len(formatted_reports)
        }), 200
        
    except Exception as e:
        logger.error(f"Get user reports error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/create_tracking_session", methods=["POST"])
def create_tracking_session():
    try:
        data = request.json or {}
        
        user_id = data.get("user_id")
        user_name = data.get("user_name", "User")
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        duration_minutes = data.get("duration_minutes", 30)
        
        if not all([latitude, longitude]):
            return jsonify({"success": False, "error": "Location required"}), 400
        
        # Generate unique session ID
        session_id = secrets.token_urlsafe(16)
        
        # Calculate expiry time
        expires_at = None
        if duration_minutes > 0:
            expires_at = datetime.now() + timedelta(minutes=duration_minutes)
        
        # Initial location
        initial_location = {
            "lat": float(latitude),
            "lng": float(longitude),
            "timestamp": datetime.now().isoformat(),
            "speed": 0,
            "accuracy": 0
        }
        
        # Store session
        tracking_sessions[session_id] = {
            "user_id": user_id,
            "user_name": user_name,
            "locations": [initial_location],
            "created_at": datetime.now().isoformat(),
            "expires_at": expires_at.isoformat() if expires_at else None,
            "is_active": True,
            "last_updated": datetime.now().isoformat(),
            "duration_minutes": duration_minutes,
            "total_updates": 1
        }
        
        # ====== FIXED: Create PROPER publicly accessible URL ======
        
        # Method 1: Try to get public URL from ngrok if running
        public_url = None
        try:
            if NGROK_AUTHTOKEN:
                # Get ngrok tunnels
                tunnels = ngrok.get_tunnels()
                if tunnels:
                    public_url = tunnels[0].public_url
                    logger.info(f"Using ngrok public URL: {public_url}")
        except:
            pass
        
        # Method 2: Use request host with fallback
        if not public_url:
            # Check if request.host is localhost or internal IP
            request_host = request.host
            if request_host.startswith(('localhost', '127.', '192.168.', '10.', '172.')):
                # This is local/internal, need external URL
                # Try to get server's public IP
                try:
                    import socket
                    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    s.connect(('8.8.8.8', 80))
                    server_ip = s.getsockname()[0]
                    s.close()
                    
                    # Create URL with public IP (if you have port forwarding)
                    public_url = f"http://{server_ip}:5000"
                    logger.info(f"Using server IP: {public_url}")
                    
                    # Check if this IP is public
                    if server_ip.startswith(('192.168.', '10.', '172.')):
                        logger.warning("Server IP is private, URL may not be accessible!")
                        # Fallback to ngrok setup message
                        public_url = "https://setup-ngrok-first.hersheild.com"
                except:
                    public_url = "https://setup-server-properly.hersheild.com"
            else:
                # Use request host as-is
                public_url = f"http://{request_host}"
        
        # Ensure URL doesn't have double slashes
        public_url = public_url.rstrip('/')
        
        # Create the tracking URL - SIMPLE and CLEAN
        tracking_url = f"{public_url}/track/{session_id}"
        
        # Also create Google Maps link for reference
        google_maps_link = f"https://www.google.com/maps?q={latitude},{longitude}"
        
        logger.info(f"Created tracking session: {session_id}")
        logger.info(f"Tracking URL: {tracking_url}")
        logger.info(f"Public URL base: {public_url}")
        
        return jsonify({
            "success": True,
            "session_id": session_id,
            "tracking_url": tracking_url,  # clickable
            "expires_at": expires_at.isoformat() if expires_at else None,
            "message": "Tracking session created successfully"
        }), 200
        
    except Exception as e:
        logger.error(f"Create tracking session error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/update_location/<session_id>", methods=["POST"])
def update_location(session_id):
    try:
        data = request.json or {}
        
        if session_id not in tracking_sessions:
            return jsonify({"success": False, "error": "Invalid session"}), 404
        
        session = tracking_sessions[session_id]
        
        # Check if session expired
        if session["expires_at"]:
            if datetime.now() > datetime.fromisoformat(session["expires_at"]):
                session["is_active"] = False
                socketio.emit('session_ended', {'session_id': session_id}, room=session_id)
                return jsonify({"success": False, "error": "Session expired"}), 400
        
        if not session["is_active"]:
            return jsonify({"success": False, "error": "Session stopped"}), 400
        
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        timestamp = data.get("timestamp", datetime.now().isoformat())
        
        if not all([latitude, longitude]):
            return jsonify({"success": False, "error": "Location required"}), 400
        
        # Create new location object
        new_location = {
            "lat": float(latitude),
            "lng": float(longitude),
            "timestamp": timestamp,
            "speed": data.get("speed", 0),
            "accuracy": data.get("accuracy", 0)
        }
        
        # Update location history (keep last 100 locations)
        session["locations"].append(new_location)
        if len(session["locations"]) > 100:
            session["locations"] = session["locations"][-100:]
        
        session["last_updated"] = datetime.now().isoformat()
        session["total_updates"] += 1
        
        # Broadcast to WebSocket clients
        socketio.emit('location_update', {
            'session_id': session_id,
            'location': new_location,
            'total_updates': session["total_updates"]
        }, room=session_id)
        
        logger.debug(f"Location updated for session {session_id}: {latitude}, {longitude}")
        
        return jsonify({
            "success": True,
            "message": "Location updated",
            "total_updates": session["total_updates"],
            "timestamp": timestamp
        }), 200
        
    except Exception as e:
        logger.error(f"Update location error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/track/<session_id>", methods=["GET"])
def view_tracking(session_id):
    """Render live tracking page"""
    try:
        if session_id not in tracking_sessions:
            # Return 404 page
            html_404 = '''<!DOCTYPE html>
<html>
<head>
    <title>Session Not Found</title>
    <style>
        body {
            font-family: -apple-system, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
        }
        .container {
            padding: 40px;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
        }
        h1 { font-size: 48px; margin: 0; }
        p { font-size: 18px; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️</h1>
        <h2>Session Not Found</h2>
        <p>This tracking session has expired or does not exist.</p>
    </div>
</body>
</html>'''
            return html_404, 404
        
        session = tracking_sessions[session_id]
        latest_location = session["locations"][-1] if session["locations"] else None
        
        # Get server host - use request.host for reliability
        server_host = request.host
        if ':' not in server_host:
            server_host += ":5000"
        
        # Extract just the hostname for WebSocket
        server_hostname = server_host.split(':')[0]
        
        server_url = f"http://{server_host}"
        websocket_url = f"ws://{server_hostname}:5000"
        
        initial_lat = latest_location['lat'] if latest_location else 0
        initial_lng = latest_location['lng'] if latest_location else 0
        
        # Escape user name for HTML
        user_name = session['user_name'].replace('"', '&quot;').replace("'", "&#39;")
        
        html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>Live Tracking - {user_name}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.socket.io/4.5.0/socket.io.min.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body, html {{ width: 100%; height: 100%; font-family: -apple-system, sans-serif; }}
        
        #map {{ width: 100%; height: 100%; }}
        
        /* Header with user info */
        .tracking-header {{
            position: absolute;
            top: 20px;
            left: 20px;
            right: 20px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 20px;
            z-index: 1000;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.3);
        }}
        
        .user-info {{
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 15px;
        }}
        
        .avatar {{
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 25px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 20px;
            font-weight: bold;
        }}
        
        .user-details h2 {{
            font-size: 18px;
            color: #333;
            margin-bottom: 4px;
        }}
        
        .user-details p {{
            font-size: 14px;
            color: #666;
            display: flex;
            align-items: center;
            gap: 5px;
        }}
        
        .tracking-status {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-top: 15px;
            border-top: 1px solid rgba(0, 0, 0, 0.1);
        }}
        
        .live-indicator {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        
        .live-dot {{
            width: 10px;
            height: 10px;
            background: #ff4757;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }}
        
        @keyframes pulse {{
            0% {{ opacity: 1; transform: scale(1); }}
            50% {{ opacity: 0.5; transform: scale(1.1); }}
            100% {{ opacity: 1; transform: scale(1); }}
        }}
        
        .status-text {{
            font-weight: 600;
            color: #ff4757;
            font-size: 14px;
        }}
        
        .last-update {{
            font-size: 12px;
            color: #888;
            display: flex;
            align-items: center;
            gap: 5px;
        }}
        
        /* Location Info */
        .location-info {{
            position: absolute;
            bottom: 30px;
            left: 20px;
            right: 20px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 15px;
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }}
        
        .location-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }}
        
        .location-item {{
            display: flex;
            flex-direction: column;
        }}
        
        .location-label {{
            font-size: 11px;
            color: #666;
            margin-bottom: 2px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        
        .location-value {{
            font-size: 14px;
            font-weight: 600;
            color: #333;
        }}
        
        /* Loading */
        .loading-overlay {{
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        }}
        
        .spinner {{
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #570a1c;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }}
        
        @keyframes spin {{
            0% {{ transform: rotate(0deg); }}
            100% {{ transform: rotate(360deg); }}
        }}
    </style>
</head>
<body>
    <div id="map"></div>
    
    <div class="tracking-header">
        <div class="user-info">
            <div class="avatar">{user_name[0].upper() if user_name else 'U'}</div>
            <div class="user-details">
                <h2>{user_name}</h2>
                <p><i class="fas fa-shield-alt"></i> HerShield Live Location</p>
            </div>
        </div>
        <div class="tracking-status">
            <div class="live-indicator">
                <div class="live-dot"></div>
                <span class="status-text">LIVE TRACKING</span>
            </div>
            <div class="last-update">
                <i class="far fa-clock"></i>
                <span id="lastUpdateTime">Just now</span>
            </div>
        </div>
    </div>
    
    <div class="location-info">
        <div class="location-grid">
            <div class="location-item">
                <span class="location-label">LATITUDE</span>
                <span class="location-value" id="latValue">{initial_lat:.6f}</span>
            </div>
            <div class="location-item">
                <span class="location-label">LONGITUDE</span>
                <span class="location-value" id="lngValue">{initial_lng:.6f}</span>
            </div>
            <div class="location-item">
                <span class="location-label">UPDATES</span>
                <span class="location-value" id="updateCount">{session['total_updates']}</span>
            </div>
            <div class="location-item">
                <span class="location-label">STATUS</span>
                <span class="location-value" id="statusValue">Active</span>
            </div>
        </div>
    </div>
    
    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <h3>Loading live tracking...</h3>
        <p id="loadingText">Connecting to {user_name}'s location</p>
    </div>
    
    <script>
        // Global variables
        let map = null;
        let marker = null;
        let polyline = null;
        let locationsHistory = [];
        let currentLat = {initial_lat};
        let currentLng = {initial_lng};
        let socket = null;
        let isConnected = false;
        
        // Initialize map
        function initMap() {{
            // Create map
            map = L.map('map').setView([currentLat, currentLng], 16);
            
            // Use OpenStreetMap tiles (no API key needed)
            L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19,
            }}).addTo(map);
            
            // Create custom icon
            const customIcon = L.divIcon({{
                html: '<div style="background: #570a1c; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
                className: 'location-marker',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }});
            
            // Add marker
            marker = L.marker([currentLat, currentLng], {{ 
                icon: customIcon,
                title: '{user_name}'
            }}).addTo(map);
            
            // Add popup with user info
            updatePopup();
            
            // Add polyline for path
            polyline = L.polyline([], {{
                color: '#570a1c',
                weight: 3,
                opacity: 0.7,
                smoothFactor: 1
            }}).addTo(map);
            
            // Add initial location to history
            locationsHistory.push([currentLat, currentLng]);
            updatePolyline();
            
            // Hide loading
            document.getElementById('loadingOverlay').style.display = 'none';
            
            // Connect to WebSocket
            connectWebSocket();
        }}
        
        function connectWebSocket() {{
            console.log('Connecting to WebSocket at:', '{websocket_url}');
            
            socket = io('{websocket_url}');
            
            socket.on('connect', function() {{
                console.log('✅ Connected to WebSocket');
                isConnected = true;
                document.getElementById('statusValue').textContent = 'Connected';
                
                // Join the tracking session
                socket.emit('join_session', {{ 
                    session_id: '{session_id}' 
                }});
            }});
            
            socket.on('session_joined', function(data) {{
                console.log('Joined session:', data);
                updateStatus('Connected');
            }});
            
            socket.on('location_update', function(data) {{
                console.log('Location update received:', data);
                if (data.session_id === '{session_id}') {{
                    updateLocation(
                        data.location.lat,
                        data.location.lng,
                        data.total_updates,
                        data.location.timestamp
                    );
                }}
            }});
            
            socket.on('session_ended', function(data) {{
                if (data.session_id === '{session_id}') {{
                    updateStatus('Session Ended');
                    alert('⚠️ Live tracking session has ended.');
                }}
            }});
            
            socket.on('disconnect', function() {{
                console.log('❌ Disconnected from WebSocket');
                isConnected = false;
                updateStatus('Connection Failed');
            }});
            
            socket.on('connect_error', function(error) {{
                console.log('WebSocket connection error:', error);
                updateStatus('Connection Failed');
                // Fallback to HTTP polling
                startPolling();
            }});
        }}
        
        function startPolling() {{
            // Fallback to HTTP polling if WebSocket fails
            setInterval(function() {{
                fetch('{server_url}/get_latest_location/{session_id}')
                    .then(response => response.json())
                    .then(data => {{
                        if (data.success && data.latest_location) {{
                            updateLocation(
                                data.latest_location.lat,
                                data.latest_location.lng,
                                data.total_updates,
                                data.latest_location.timestamp
                            );
                        }}
                    }})
                    .catch(error => console.error('Polling error:', error));
            }}, 10000); // Poll every 10 seconds
        }}
        
        function updateLocation(lat, lng, totalUpdates, timestamp) {{
            // Update current values
            currentLat = lat;
            currentLng = lng;
            
            // Update marker position
            marker.setLatLng([lat, lng]);
            
            // Add to history and update polyline
            locationsHistory.push([lat, lng]);
            if (locationsHistory.length > 100) {{
                locationsHistory.shift();
            }}
            updatePolyline();
            
            // Update UI
            updateLocationInfo(totalUpdates, timestamp);
            
            // Update popup
            updatePopup();
            
            // Smooth pan to new location
            if (map.getZoom() >= 15) {{
                map.panTo([lat, lng], {{
                    animate: true,
                    duration: 1
                }});
            }}
        }}
        
        function updatePolyline() {{
            if (locationsHistory.length > 1) {{
                polyline.setLatLngs(locationsHistory);
            }}
        }}
        
        function updatePopup() {{
            const updateTime = new Date().toLocaleTimeString();
            const popupContent = `<div style="font-family: -apple-system, sans-serif; min-width: 200px;">
                <div style="font-weight: bold; color: #570a1c; margin-bottom: 5px;">{user_name}</div>
                <div style="font-size: 12px; color: #666; margin-bottom: 10px;">Live Location</div>
                <div style="font-size: 11px; color: #888;">
                    <div>Lat: ${{currentLat.toFixed(6)}}</div>
                    <div>Lng: ${{currentLng.toFixed(6)}}</div>
                    <div>Updated: ${{updateTime}}</div>
                    <div>Accuracy: 10m</div>
                </div>
            </div>`;
            
            marker.bindPopup(popupContent);
        }}
        
        function updateLocationInfo(totalUpdates, timestamp) {{
            document.getElementById('latValue').textContent = currentLat.toFixed(6);
            document.getElementById('lngValue').textContent = currentLng.toFixed(6);
            document.getElementById('updateCount').textContent = totalUpdates;
            
            if (timestamp) {{
                const updateTime = new Date(timestamp).toLocaleTimeString();
                document.getElementById('lastUpdateTime').textContent = updateTime;
            }}
        }}
        
        function updateStatus(status) {{
            document.getElementById('statusValue').textContent = status;
        }}
        
        // Initialize map when page loads
        window.onload = initMap;
        
        // Add error handling for map
        window.addEventListener('error', function(e) {{
            console.error('Page error:', e);
            document.getElementById('loadingText').textContent = 'Error loading map';
        }});
    </script>
    
    <!-- Add Font Awesome for icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</body>
</html>'''
        
        return html_content, 200
        
    except Exception as e:
        logger.error(f"Tracking page error: {e}")
        return f"Error loading tracking page: {str(e)}", 500    

@app.route("/track_debug/<session_id>", methods=["GET"])
def view_tracking_debug(session_id):
    """Debug version to see what's happening"""
    try:
        logger.info(f"Tracking page requested for: {session_id}")
        logger.info(f"Active sessions: {list(tracking_sessions.keys())}")
        
        if session_id not in tracking_sessions:
            return jsonify({
                "error": "Session not found",
                "requested_session": session_id,
                "available_sessions": list(tracking_sessions.keys())
            }), 404
        
        session = tracking_sessions[session_id]
        return jsonify({
            "success": True,
            "session_exists": True,
            "user_name": session['user_name'],
            "is_active": session['is_active'],
            "total_updates": session['total_updates'],
            "locations_count": len(session['locations'])
        }), 200
        
    except Exception as e:
        logger.error(f"Debug error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/get_latest_location/<session_id>", methods=["GET"])
def get_latest_location(session_id):
    """Get the latest location for a session (for HTTP polling fallback)"""
    if session_id not in tracking_sessions:
        return jsonify({"success": False, "error": "Session not found"}), 404
    
    session = tracking_sessions[session_id]
    latest_location = session["locations"][-1] if session["locations"] else None
    
    return jsonify({
        "success": True,
        "latest_location": latest_location,
        "total_updates": session["total_updates"],
        "is_active": session["is_active"]
    }), 200


# WebSocket events
@socketio.on('connect')
def handle_connect():
    """When a new WebSocket client connects"""
    logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    """When a WebSocket client disconnects"""
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_session')
def handle_join_session(data):
    """Client joins a specific tracking session"""
    session_id = data.get('session_id')
    if session_id in tracking_sessions:
        join_room(session_id)  # Now this will work!
        active_connections[session_id] = active_connections.get(session_id, 0) + 1
        
        # Send current location to the new client
        session = tracking_sessions[session_id]
        if session["locations"]:
            latest = session["locations"][-1]
            emit('session_joined', {
                'session_id': session_id,
                'user_name': session['user_name'],
                'latest_location': latest,
                'total_updates': session['total_updates'],
                'is_active': session['is_active']
            }, room=request.sid)  # Send only to this client
        
        logger.info(f"Client joined session: {session_id}")

@socketio.on('leave_session')
def handle_leave_session(data):
    """Client leaves a tracking session"""
    session_id = data.get('session_id')
    if session_id in tracking_sessions:
        leave_room(session_id)
        logger.info(f"Client left session: {session_id}")

@app.route("/stop_tracking_session", methods=["POST"])
def stop_tracking_session():
    try:
        data = request.json or {}
        session_id = data.get("session_id")
        
        if session_id not in tracking_sessions:
            return jsonify({"success": False, "error": "Invalid session"}), 404
        
        tracking_sessions[session_id]["is_active"] = False
        
        # Notify WebSocket clients
        socketio.emit('session_ended', {'session_id': session_id}, room=session_id)
        
        logger.info(f"Stopped tracking session: {session_id}")
        
        return jsonify({
            "success": True,
            "message": "Tracking stopped"
        }), 200
        
    except Exception as e:
        logger.error(f"Stop tracking error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/safe_route", methods=["POST"])
def safe_route():
    data = request.json or {}
    
    start = data.get("start")
    end = data.get("end")
    mode = data.get("mode", "walk")

    if not start or not end:
        return jsonify({"success": False, "error": "Invalid coordinates"}), 400

    speed = TRAVEL_SPEEDS.get(mode, 4.5)
    
    print(f"🚀 Safe route request: {start} -> {end}, mode={mode}")
    
    # ========== QUICK RETURN FOR VERY SHORT DISTANCES ==========
    direct_distance = geodesic((start["lat"], start["lng"]), (end["lat"], end["lng"])).km
    if direct_distance < 0.1:  # Less than 100m
        print(f"📍 Very short route ({direct_distance:.2f}km), returning direct path")
        return jsonify({
            "success": True,
            "route": {
                "distance_km": round(direct_distance, 2),
                "duration_min": int((direct_distance / speed) * 60),
                "safety_score": 100,
                "incident_count": 0,
                "coords": [
                    (start["lat"], start["lng"]),
                    (end["lat"], end["lng"])
                ]
            }
        }), 200

    # ========== OPTIMIZED INCIDENT FETCHING ==========
    # Only fetch incidents in a reasonable area around the route
    buffer = 0.03  # ~3km buffer (reduced from larger area)
    min_lat = min(start["lat"], end["lat"]) - buffer
    max_lat = max(start["lat"], end["lat"]) + buffer
    min_lng = min(start["lng"], end["lng"]) - buffer
    max_lng = max(start["lng"], end["lng"]) + buffer

    db = get_db()
    cursor = db.cursor(dictionary=True)
    
    try:
        # Get only recent incidents (last 6 months) in the area
        cursor.execute("""
            SELECT 
                latitude, 
                longitude, 
                COALESCE(severity, 5) as severity,  # Default to 5 if null
                COALESCE(incident_type, 'other') as incident_type,
                created_at,
                TIMESTAMPDIFF(HOUR, created_at, NOW()) as hours_old
            FROM incident_reports
            WHERE latitude BETWEEN %s AND %s
            AND longitude BETWEEN %s AND %s
            AND created_at >= NOW() - INTERVAL 180 DAY  # Last 6 months only
            ORDER BY created_at DESC
            LIMIT 50  # Strict limit for performance
        """, (min_lat, max_lat, min_lng, max_lng))
        
        rows = cursor.fetchall()
        print(f"📊 Found {len(rows)} incidents in area")
        
    except Exception as e:
        print(f"❌ Database error: {e}")
        rows = []
    finally:
        cursor.close()
        db.close()

    # ========== SIMPLIFIED INCIDENT WEIGHTING ==========
    # For performance, use simpler weighting
    incidents = []
    for r in rows:
        base_severity = float(r["severity"]) if r["severity"] else 5.0
        
        # Simple time decay: recent = 1.0, old = 0.3
        hours_old = r["hours_old"] or 0
        days_old = hours_old / 24
        
        if days_old <= 7:    time_decay = 1.0
        elif days_old <= 30: time_decay = 0.7
        elif days_old <= 90: time_decay = 0.4
        elif days_old <= 180: time_decay = 0.2
        else:                time_decay = 0.1
        
        # Simplified severity: base * time decay
        weighted_severity = base_severity * time_decay
        
        incidents.append({
            "lat": float(r["latitude"]),
            "lng": float(r["longitude"]),
            "severity": weighted_severity
        })

    # ========== FAST PATH FINDING WITH TIMEOUT ==========
    print(f"🔄 Finding path with {len(incidents)} weighted incidents...")
    
    try:
        path = a_star_safe_path(
            (start["lat"], start["lng"]),
            (end["lat"], end["lng"]),
            incidents,
            max_time=2.0  # 2 second timeout
        )
    except Exception as e:
        print(f"❌ Pathfinding error: {e}")
        # Fallback: straight line
        path = [(start["lat"], start["lng"]), (end["lat"], end["lng"])]

    # ========== CALCULATE DISTANCE ==========
    if len(path) < 2:
        distance_km = direct_distance
    else:
        distance_km = 0
        for i in range(len(path) - 1):
            distance_km += geodesic(path[i], path[i + 1]).km
    
    duration_min = int((distance_km / speed) * 60)
    
    # ========== QUICK RISK CALCULATION ==========
    route_incidents = set()

    # Ensure we always check at least 5 points
    sample_points = path if len(path) <= 5 else path[::max(1, len(path)//5)]


    for point in sample_points:
        for inc in incidents:
            dist = geodesic(point, (inc["lat"], inc["lng"])).km
            if dist < 1.5:  # 1.5km radius for safety apps
                # Impact decreases with distance
                impact = inc["severity"] * (1.0 - (dist / 1.5))
                route_incidents.add((inc["lat"], inc["lng"]))

    incident_count = len(route_incidents)

    # ========== SIMPLE SAFETY SCORE ==========
    if distance_km == 0:
        safety_score = 100
    else:
        base_score = 100

        # Penalty based on number of incidents
        if incident_count >= 12:
            base_score -= 80   # Avoid
        elif incident_count >= 8:
            base_score -= 60   # High Risk
        elif incident_count >= 5:
            base_score -= 40   # Risky
        elif incident_count >= 3:
            base_score -= 20   # Moderate
        elif incident_count >= 1:
            base_score -= 10   # Still fairly safe

        safety_score = max(0, min(100, base_score))
   

    # ========== RESPONSE ==========
    print(
    f"[DEBUG] incidents={len(incidents)}, "
    f"route_hits={incident_count}, "
    f"safety={safety_score}"
)


    return jsonify({
        "success": True,
        "route": {
            "distance_km": round(distance_km, 2),
            "duration_min": duration_min,
            "safety_score": safety_score,
            "incident_count": incident_count,
            "coords": path[:100] if len(path) > 100 else path
        }
    }), 200


@app.route("/debug_url", methods=["GET"])
def debug_url():
    """Debug endpoint to check what URLs are being generated"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        server_ip = s.getsockname()[0]
        s.close()
    except:
        server_ip = "localhost"
    
    return jsonify({
        "request.host": request.host,
        "request.host_url": request.host_url,
        "request.base_url": request.base_url,
        "request.url": request.url,
        "detected_server_ip": server_ip,
        "sample_tracking_url": f"http://{server_ip}:5000/track/test123"
    }), 200        

@app.route("/get_session_info/<session_id>", methods=["GET"])
def get_session_info(session_id):
    """API endpoint to get session info (for mobile app)"""
    if session_id not in tracking_sessions:
        return jsonify({"success": False, "error": "Session not found"}), 404
    
    session = tracking_sessions[session_id]
    return jsonify({
        "success": True,
        "session": {
            "user_name": session["user_name"],
            "created_at": session["created_at"],
            "last_updated": session["last_updated"],
            "is_active": session["is_active"],
            "total_updates": session["total_updates"],
            "latest_location": session["locations"][-1] if session["locations"] else None
        }
    }), 200

# message generation endpoints
@app.route("/generate_share_message", methods=["POST"])
def generate_share_message():
    """Centralized endpoint for all sharing messages"""
    try:
        data = request.json or {}
        
        message_type = data.get("type")  # "live_location" or "safe_route"
        user_id = data.get("user_id")
        
        if not message_type or not user_id:
            return jsonify({"success": False, "error": "Missing required data"}), 400
        
        # Get user info once
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT fullname, email_id, mobile_no 
            FROM users 
            WHERE id = %s
        """, (user_id,))
        user = cursor.fetchone()
        cursor.close()
        db.close()
        
        if not user:
            return jsonify({"success": False, "error": "User not found"}), 404
        
        # Get the actual user name
        display_name = user.get('fullname') or user.get('email_id', '').split('@')[0] or "User"
        
        message = ""
        
        if message_type == "live_location":
            # Generate live location message
            tracking_url = data.get("tracking_url")
            duration_text = data.get("duration_text", "30 minutes")
            address = data.get("address", "Current location")
            
            if not tracking_url:
                return jsonify({"success": False, "error": "Tracking URL required"}), 400
            
            message = f"""📍 HerShield Live Location

{display_name} is sharing their live location with you

🔗 Tracking Link:
{tracking_url}

📍 Current Location:
{address}

⏱️ Duration: {duration_text}

Shared via HerShield Safety App"""
            
        elif message_type == "safe_route":
            # Generate safe route message
            location_name = data.get("location_name", "Destination")
            distance_raw = data.get("distance", 0)
            duration_raw = data.get("duration", 0)
            safety_score = data.get("safety_score", 0)
            incident_count = data.get("incident_count", 0)
            address = data.get("address", "Current location")

            # Handle both formatted strings and raw numbers
            if isinstance(distance_raw, str):
                distance = distance_raw
            else:
                distance = f"{float(distance_raw):.2f} km" if distance_raw else "0 km"

            if isinstance(duration_raw, str):
                duration = duration_raw
            else:
                duration = f"{int(duration_raw)} min" if duration_raw else "0 min"

            current_time = datetime.now().strftime("%I:%M %p")

            safety_emoji = "🟢" if safety_score >= 80 else "🟡" if safety_score >= 60 else "🔴"
            risk_info = f"⚠️ {incident_count} risk zones avoided" if incident_count > 0 else "✅ No risk zones detected"

            # Build message explicitly to avoid any duplication issues
            message_parts = [
                f"🚶‍♀️ HerShield Safe Route - {display_name}",
                "",
                f"📍 Current Location ({current_time}):",
                address,
                "",
                "🎯 Destination:",
                location_name,
                "",
                f"📏 Distance: {distance}",
                f"⏱️ Estimated Time: {duration}",
                f"{safety_emoji} Safety Score: {safety_score}/100",
                "",
                risk_info,
                "",
                "Shared via HerShield App"
            ]

            message = "\n".join(message_parts)
        
        else:
            return jsonify({"success": False, "error": "Invalid message type"}), 400
        
        return jsonify({
            "success": True,
            "message": message,
            "user_name": display_name,
            "type": message_type
        }), 200
        
    except Exception as e:
        logger.error(f"Message generation error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# ========== SIMPLE NGROK SETUP ==========
def setup_ngrok():
    """Start ngrok with better error handling"""
    try:
        token = os.getenv('NGROK_AUTHTOKEN')
        if not token:
            print("ℹ️  No NGROK_AUTHTOKEN in .env")
            return None
        
        print("🚀 Starting ngrok...")
        
        # Method 1: Kill any existing ngrok using psutil (better)
        try:
            for proc in psutil.process_iter(['name']):
                if proc.info['name'] and 'ngrok' in proc.info['name'].lower():
                    try:
                        proc.terminate()
                        proc.wait(timeout=2)
                        print(f"✅ Stopped existing ngrok (PID: {proc.pid})")
                    except:
                        try:
                            proc.kill()
                        except:
                            pass
        except ImportError:
            # Method 2: Use subprocess if psutil not available
            try:
                if os.name == 'nt':  # Windows
                    subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'], 
                                 capture_output=True, shell=True)
                else:  # Mac/Linux
                    subprocess.run(['pkill', 'ngrok'], 
                                 capture_output=True)
                print("✅ Stopped any existing ngrok")
            except:
                pass
        
        # Configure ngrok
        conf.get_default().auth_token = token
        
        # Try to connect
        try:
            tunnel = ngrok.connect(5000, "http")
            url = tunnel.public_url
            
            print("\n" + "="*60)
            print("✅ NGrok Started!")
            print("="*60)
            print(f"🔗 Public URL: {url}")
            print("="*60)
            
            return url
            
        except Exception as connect_error:
            error_str = str(connect_error)
            print(f"❌ Ngrok connection error: {error_str[:200]}")
            
            # Check if there's already a tunnel
            try:
                tunnels = ngrok.get_tunnels()
                if tunnels and len(tunnels) > 0:
                    existing_url = tunnels[0].public_url
                    print(f"\n⚠️  Found existing ngrok tunnel: {existing_url}")
                    return existing_url
            except:
                pass
            
            return None
            
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Ngrok setup failed: {error_msg[:200]}")
        return None

def check_ngrok_status():
    """Check if ngrok is running and get public URL"""
    try:
        tunnels = ngrok.get_tunnels()
        if tunnels and len(tunnels) > 0:
            return {
                "running": True,
                "tunnel_count": len(tunnels),
                "public_url": tunnels[0].public_url,
                "tunnels": [t.public_url for t in tunnels]
            }
        else:
            return {
                "running": False,
                "tunnel_count": 0,
                "public_url": None,
                "message": "No active ngrok tunnels"
            }
    except Exception as e:
        return {
            "running": False,
            "error": str(e),
            "public_url": None,
            "message": "Failed to check ngrok status"
        }      

# Start ngrok in background
threading.Thread(target=setup_ngrok, daemon=True).start()

if __name__ == "__main__":
    logger.info("Starting HerShield backend with WebSocket support...")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)