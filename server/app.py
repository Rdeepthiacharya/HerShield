from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import mysql.connector
import os
from dotenv import load_dotenv
from geopy.distance import geodesic
import wave
import json
import torch
import torchaudio
import soundfile as sf
import librosa
from rapidfuzz import fuzz
from vosk import Model, KaldiRecognizer
from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification
from loguru import logger
import math
import heapq
from datetime import datetime, timedelta, timezone
from dateutil import parser
import secrets
import json
import secrets
import threading
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template_string
from flask_socketio import SocketIO, emit
import logging
import requests



# ENV + BASIC PATHS----------------------------------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USER_DATA_DIR = os.path.join(BASE_DIR, "user_data")
TEMP_AUDIO_DIR = os.path.join(BASE_DIR, "temp_audio")
VOSK_MODEL_DIR = os.path.join(BASE_DIR, "ml", "vosk_model")

FAST2SMS_API_KEY = os.getenv("FAST2SMS_API_KEY", "")
GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY", "")


app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
logger = logging.getLogger(__name__)

# Store active tracking sessions
tracking_sessions = {}
# WebSocket connections for real-time updates
active_connections = {}


# DB CONNECTION----------------------------------
def get_db():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
    )


# LOAD ML MODELS----------------------------------
logger.info("Loading ML models...")

# Vosk STT
if not os.path.exists(VOSK_MODEL_DIR):
    logger.error(f"Vosk model not found at {VOSK_MODEL_DIR}")
    raise RuntimeError(f"Vosk model not found at {VOSK_MODEL_DIR}")
vosk_model = Model(VOSK_MODEL_DIR)
logger.info("Vosk STT model loaded")

# Emotion model
try:
    emotion_processor = Wav2Vec2FeatureExtractor.from_pretrained(
        "superb/wav2vec2-base-superb-er"
    )
    emotion_model = Wav2Vec2ForSequenceClassification.from_pretrained(
        "superb/wav2vec2-base-superb-er"
    )
    emotion_labels = ["anger", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
    logger.info("Emotion recognition model loaded")
except Exception as e:
    logger.warning(f"Emotion model failed: {e}")
    emotion_processor = None
    emotion_model = None
    emotion_labels = ["neutral"]


# HELPERS----------------------------------
def get_user_voice_path(uid: int) -> str:
    folder = os.path.join(USER_DATA_DIR, str(uid))
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "voice.wav")

def stt_with_vosk(wav_path: str) -> str:
    try:
        wf = wave.open(wav_path, "rb")
        rec = KaldiRecognizer(vosk_model, wf.getframerate())

        text = ""
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                res = json.loads(rec.Result())
                text += " " + res.get("text", "")

        final = json.loads(rec.FinalResult())
        text += " " + final.get("text", "")
        return text.strip().lower()
    except Exception as e:
        logger.error(f"Vosk STT error: {e}")
        return ""

danger_words = [
    "help", "help me", "leave me",
    "please help", "save me", "don't touch me", "stop", "please stop", "no"
]

def detect_keyword(text: str):
    if not text:
        return None
    for word in danger_words:
        if fuzz.partial_ratio(word, text) > 80:
            return word
    return None

def detect_emotion(wav_path: str) -> str:
    if emotion_model is None or emotion_processor is None:
        return "neutral"
    try:
        audio, sr = librosa.load(wav_path, sr=16000)
        inputs = emotion_processor(audio, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            logits = emotion_model(**inputs).logits
        idx = int(torch.argmax(logits))
        return emotion_labels[idx]
    except Exception as e:
        logger.warning(f"Emotion detection failed: {e}")
        return "neutral"

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


# SAFE ROUTING HELPERS----------------------------------
# Reverse geocoding function (simplified)
def reverse_geocode(lat, lon):
    """Simple reverse geocoding - you can use a real API here"""
    try:
        # For now, return a simple location string
        # You can implement Google Maps or OpenStreetMap API here
        return f"Location at {lat:.4f}, {lon:.4f}"
    except:
        return "Unknown location"

# SAFE ROUTING HELPERS----------------------------------
def haversine_distance(lat1, lon1, lat2, lon2):
    """Simple haversine distance in km."""
    return geodesic((lat1, lon1), (lat2, lon2)).km

def weighted_risk_score(distance_km, time_decay_hours, severity):
    """Risk decreases with distance and time."""
    distance_weight = 1 / (1 + distance_km)
    time_weight = math.exp(-time_decay_hours / 24)
    return severity * distance_weight * time_weight

def a_star_safe_path(start_coords, end_coords, risk_zones):
    """
    A* over a coarse grid, adding cost when near risk zones.
    risk_zones: list of (lat, lon, severity, created_at)
    """
    def heuristic(a, b):
        return geodesic(a, b).km

    def get_neighbors(node):
        lat, lon = node
        neighbors = []
        step = 0.005  # Smaller step (~500m) for more precise path
        for dlat in [-step, 0, step]:
            for dlon in [-step, 0, step]:
                if dlat == 0 and dlon == 0:
                    continue
                neighbors.append((lat + dlat, lon + dlon))
        return neighbors

    frontier = []
    heapq.heappush(frontier, (0, start_coords))
    came_from = {start_coords: None}
    cost_so_far = {start_coords: 0}

    # Safety counter to prevent infinite loops
    max_iterations = 1000
    iteration = 0

    while frontier and iteration < max_iterations:
        iteration += 1
        _, current = heapq.heappop(frontier)

        # If we're close enough to destination
        if heuristic(current, end_coords) < 0.5:  # Within ~500m
            break

        for neighbor in get_neighbors(current):
            # Basic distance cost
            distance_cost = geodesic(current, neighbor).km

            # Risk cost from nearby incidents
            risk_cost = 0
            current_time = datetime.now()
            
            for (zlat, zlon, sev, created_at) in risk_zones:
                # Calculate distance to risk zone
                d = geodesic(neighbor, (zlat, zlon)).km
                
                if d < 2:  # Consider incidents within 2km radius
                    # Calculate time decay (hours since incident)
                    time_diff = (current_time - created_at).total_seconds() / 3600
                    
                    # Only consider recent incidents (last 48 hours)
                    if time_diff < 48:
                        risk_cost += weighted_risk_score(d, time_diff, sev)

            new_cost = cost_so_far[current] + distance_cost + (risk_cost * 5)  # Weight risk higher

            if neighbor not in cost_so_far or new_cost < cost_so_far[neighbor]:
                cost_so_far[neighbor] = new_cost
                priority = new_cost + heuristic(neighbor, end_coords)
                heapq.heappush(frontier, (priority, neighbor))
                came_from[neighbor] = current

    # Reconstruct path
    if not came_from:
        return []

    # Find closest node to end coordinates
    closest = None
    closest_dist = float('inf')
    for node in came_from.keys():
        d = heuristic(node, end_coords)
        if d < closest_dist:
            closest_dist = d
            closest = node

    if closest is None:
        return []

    # Build path
    path = []
    current = closest
    while current is not None:
        path.append(current)
        current = came_from.get(current)

    path.reverse()
    
    # Add actual end point if we didn't reach it
    if len(path) > 0 and heuristic(path[-1], end_coords) > 0.1:
        path.append(end_coords)
    
    # Simplify path (remove unnecessary points)
    if len(path) > 2:
        simplified_path = [path[0]]
        for i in range(1, len(path) - 1):
            prev = simplified_path[-1]
            next_point = path[i + 1]
            # Skip middle points that are roughly in line
            if geodesic(prev, path[i]).km + geodesic(path[i], next_point).km > geodesic(prev, next_point).km * 1.1:
                simplified_path.append(path[i])
        simplified_path.append(path[-1])
        path = simplified_path
    
    return path

# FLASK APP----------------------------------
app = Flask(__name__)
CORS(app)

@app.route("/")
def home():
    return jsonify({"success": True, "message": "HerShield API running"}), 200


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
    data = request.json
    user_id = data.get("user_id")
    lat = data.get("lat")
    lon = data.get("lon")
    auto = data.get("auto", False)

    tracking_url = data.get("tracking_url")
    duration_text = data.get("duration_text", "Unknown")

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


    # GOOGLE MAP LINK (LONG)-----------------------------
    if lat and lon:
        long_map_link = f"https://www.google.com/maps?q={lat},{lon}"

        # SHORT URL (NO MORE SMS WRAPPING)
        map_link = shorten_url(long_map_link)

        location_store = f"{lat},{lon}"
    else:
        map_link = "Location unavailable"
        location_store = "Unknown"

    location_store = str(location_store)

    user_name = user["fullname"]
    alert_type = "AUTOMATIC" if auto else "MANUAL"

    message = f"""HerShield SOS Alert

{user_name} activated a {alert_type} alert.

Live Tracking:
{tracking_url}

Google Maps:
{map_link}

Duration: {duration_text}
"""

    alternative_message = message

    sms_ok = send_sms(recipients, message)
    if not sms_ok:
        sms_ok = send_sms(recipients, alternative_message)

    save_sos_log(
        user_id,
        "auto" if auto else "manual",
        location_store,
        message,
        recipients=recipients,
        status="delivered" if sms_ok else "failed",
    )

    return jsonify({
        "success": sms_ok,
        "map_link": map_link,
        "coordinates": location_store
    }), 200


# -------------------- SAFE ROUTE -------------------
@app.route("/safe_route", methods=["POST"])
def safe_route():
    try:
        data = request.json or {}
        start = data.get("start")
        end = data.get("end")
        mode = data.get("mode", "multiple")  # "single" or "multiple"

        if not start or not end:
            return jsonify({
                "success": False, 
                "message": "Start and end coordinates required"
            }), 400

        start_coords = (start["lat"], start["lng"])
        end_coords = (end["lat"], end["lng"])

        logger.info(f"Calculating safe route from {start_coords} to {end_coords}")

        # Fetch risk zones (incidents from last 48 hours)
        risk_zones = []
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT latitude, longitude, severity, created_at
                FROM incident_reports
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
                AND severity >= 1
                ORDER BY created_at DESC
                """
            )
            for row in cursor.fetchall():
                risk_zones.append((
                    row["latitude"],
                    row["longitude"],
                    row["severity"],
                    row["created_at"]
                ))
            cursor.close()
            db.close()
            logger.info(f"Loaded {len(risk_zones)} risk zones")
        except Exception as e:
            logger.warning(f"Risk zone load error: {e}")
            # Continue with empty risk zones if DB fails

        if mode == "single":
            # Original behavior - return single safest route
            path = a_star_safe_path(start_coords, end_coords, risk_zones)
            
            if not path or len(path) < 2:
                logger.warning("No safe path found, returning direct route")
                # Return direct route as fallback
                path = [start_coords, end_coords]

            # Create route coordinates with risk information
            route_coords = []
            total_risk_score = 0
            
            for (lat, lon) in path:
                # Check if point is near any risk zone
                is_risky = False
                for (zlat, zlon, sev, created_at) in risk_zones:
                    if geodesic((lat, lon), (zlat, zlon)).km < 1.0:  # Within 1km
                        is_risky = True
                        total_risk_score += sev
                        break
                
                route_coords.append({
                    "latitude": lat,
                    "longitude": lon,
                    "risk": is_risky
                })

            # Calculate total distance
            total_distance = 0.0
            for i in range(len(path) - 1):
                total_distance += geodesic(path[i], path[i + 1]).km

            # Estimate duration (assuming 12 minutes per km for walking)
            estimated_duration_minutes = total_distance * 12

            # Get place names
            start_place = reverse_geocode(start_coords[0], start_coords[1])
            end_place = reverse_geocode(end_coords[0], end_coords[1])

            response = {
                "success": True,
                "routes": [
                    {
                        "coords": route_coords,
                        "distance": round(total_distance, 2),
                        "duration": round(estimated_duration_minutes, 0),
                        "total_risk": total_risk_score,
                        "best": True,
                        "start_place": start_place,
                        "end_place": end_place,
                        "waypoints": len(route_coords),
                        "has_risk_zones": len(risk_zones) > 0,
                        "type": "Safest",
                        "color": "#4CAF50"
                    }
                ],
                "has_alternatives": False,
                "risk_zones_count": len(risk_zones)
            }

            logger.info(f"Single route calculated: {total_distance:.2f}km, {len(route_coords)} waypoints")
            return jsonify(response), 200
        
        else:
            # Multiple routes mode - return 3 different options
            # Option 1: Safest route (avoiding all risks)
            safest_path = a_star_safe_path(start_coords, end_coords, risk_zones, risk_weight=100)
            
            # Option 2: Balanced route (moderate risk avoidance)
            balanced_path = a_star_safe_path(start_coords, end_coords, risk_zones, risk_weight=50)
            
            # Option 3: Fastest route (least distance, ignore risks)
            fastest_path = get_direct_route(start_coords, end_coords)
            
            # Calculate stats for each route
            routes = []
            path_options = [safest_path, balanced_path, fastest_path]
            route_types = ["Safest", "Balanced", "Fastest"]
            route_colors = ["#4CAF50", "#FFC107", "#F44336"]
            
            for i, path in enumerate(path_options):
                if not path or len(path) < 2:
                    # Fallback to direct route if path calculation fails
                    path = [start_coords, end_coords]
                
                route_coords = []
                total_risk = 0
                
                for (lat, lon) in path:
                    is_risky = False
                    for (zlat, zlon, sev, created_at) in risk_zones:
                        if geodesic((lat, lon), (zlat, zlon)).km < 0.5:  # Within 500m
                            is_risky = True
                            total_risk += sev
                            break
                    
                    route_coords.append({
                        "latitude": lat,
                        "longitude": lon,
                        "risk": is_risky
                    })
                
                # Calculate distance
                total_distance = 0.0
                for j in range(len(path) - 1):
                    total_distance += geodesic(path[j], path[j + 1]).km
                
                # Estimate duration
                estimated_duration = total_distance * 12  # 12 min/km for walking
                
                routes.append({
                    "id": i + 1,
                    "coords": route_coords,
                    "distance": round(total_distance, 2),
                    "duration": round(estimated_duration, 0),
                    "total_risk": total_risk,
                    "best": i == 0,  # First route is safest
                    "start_place": reverse_geocode(start_coords[0], start_coords[1]),
                    "end_place": reverse_geocode(end_coords[0], end_coords[1]),
                    "waypoints": len(route_coords),
                    "has_risk_zones": len(risk_zones) > 0,
                    "type": route_types[i],
                    "color": route_colors[i],
                    "description": get_route_description(route_types[i], total_risk, total_distance)
                })
            
            # Sort by risk score (safest first)
            routes.sort(key=lambda x: x["total_risk"])
            
            # Mark the safest as best
            for i, route in enumerate(routes):
                route["best"] = i == 0
            
            response = {
                "success": True,
                "routes": routes,
                "has_alternatives": len(routes) > 1,
                "risk_zones_count": len(risk_zones)
            }

            logger.info(f"Multiple routes calculated: {len(routes)} options")
            return jsonify(response), 200

    except Exception as e:
        logger.error(f"Safe route error: {e}")
        return jsonify({
            "success": False,
            "message": f"Internal server error: {str(e)}"
        }), 500


def get_direct_route(start_coords, end_coords):
    """Calculate a simple direct route between two points"""
    # Create a straight line path with 10 intermediate points
    path = []
    num_points = 10
    
    start_lat, start_lon = start_coords
    end_lat, end_lon = end_coords
    
    for i in range(num_points + 1):
        ratio = i / num_points
        lat = start_lat + (end_lat - start_lat) * ratio
        lon = start_lon + (end_lon - start_lon) * ratio
        path.append((lat, lon))
    
    return path


def get_route_description(route_type, risk_score, distance):
    """Generate a user-friendly description for each route"""
    if route_type == "Safest":
        if risk_score == 0:
            return f"Completely safe route, {distance}km"
        elif risk_score <= 2:
            return f"Minimal risks avoided, {distance}km"
        else:
            return f"Most risks avoided, {distance}km"
    elif route_type == "Balanced":
        return f"Balance of safety and distance, {distance}km"
    else:  # Fastest
        return f"Shortest distance, {distance}km"


def a_star_safe_path(start, end, risk_zones, risk_weight=100):
    """
    A* algorithm to find safe path avoiding risk zones
    
    Args:
        start: (lat, lon) tuple
        end: (lat, lon) tuple
        risk_zones: list of (lat, lon, severity, timestamp)
        risk_weight: higher value means more avoidance of risks
    
    Returns:
        List of (lat, lon) coordinates forming the path
    """
    try:
        # Simple implementation - in production, use OSRM or Google Directions API
        # This is a simplified version for demonstration
        
        # Calculate grid of possible points
        grid_size = 0.001  # ~100m resolution
        lat_step = (end[0] - start[0]) / 20
        lon_step = (end[1] - start[1]) / 20
        
        path = [start]
        
        # Add intermediate points that avoid risk zones
        for i in range(1, 20):
            # Calculate direct point
            direct_lat = start[0] + lat_step * i
            direct_lon = start[1] + lon_step * i
            
            # Check if this point is near any risk zone
            near_risk = False
            for (risk_lat, risk_lon, severity, _) in risk_zones:
                if geodesic((direct_lat, direct_lon), (risk_lat, risk_lon)).km < 0.2:
                    near_risk = True
                    break
            
            if near_risk and risk_weight > 0:
                # Adjust point to avoid risk
                # Simple adjustment: move perpendicular to the direction
                adjust_lat = direct_lat + (grid_size * 0.5)
                adjust_lon = direct_lon - (grid_size * 0.5)
                path.append((adjust_lat, adjust_lon))
            else:
                path.append((direct_lat, direct_lon))
        
        path.append(end)
        return path
        
    except Exception as e:
        logger.error(f"A* path finding error: {e}")
        # Return direct route as fallback
        return [start, end]

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

# Also update the /incident_reports/<user_id> endpoint similarly:
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

# Health check endpoint
@app.route("/health", methods=["GET"])
def health_check():
    try:
        db = get_db()
        db.ping(reconnect=True)
        db.close()
        return jsonify({
            "success": True,
            "status": "healthy",
            "timestamp": datetime.now().isoformat()
        }), 200
    except Exception as e:
        return jsonify({
            "success": False,
            "status": "unhealthy",
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
                    # Notify connected clients
                    socketio.emit('session_ended', {'session_id': session_id}, room=session_id)
            
            for session_id in sessions_to_remove:
                if session_id in tracking_sessions:
                    del tracking_sessions[session_id]
                if session_id in active_connections:
                    del active_connections[session_id]
            
            time.sleep(60)  # Check every minute
            
        except Exception as e:
            logger.error(f"Cleanup thread error: {e}")

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_thread, daemon=True)
cleanup_thread.start()

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
        
        # FIXED: Create proper tracking URL
        # Get the server's actual IP address
        import socket
        try:
            # Get local IP address
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            server_ip = s.getsockname()[0]
            s.close()
        except:
            server_ip = "localhost"
        
        # Create the tracking URL
        tracking_url = f"http://{server_ip}:5000/track/{session_id}"
        
        logger.info(f"Created tracking session: {session_id} for user {user_name}")
        
        return jsonify({
            "success": True,
            "session_id": session_id,
            "tracking_url": tracking_url,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "webSocket_url": f"ws://{server_ip}:5000"  # Also fix WebSocket URL
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
    try:
        if session_id not in tracking_sessions:
            return render_template_string("..."), 404
        
        session = tracking_sessions[session_id]
        latest_location = session["locations"][-1] if session["locations"] else None
        
        # Get server IP for WebSocket
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            server_ip = s.getsockname()[0]
            s.close()
        except:
            server_ip = "localhost"
        
        # FIXED: Use proper server IP
        server_url = f"http://{server_ip}:5000"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Live Location Tracking - HerShield</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script src="https://cdn.socket.io/4.5.0/socket.io.min.js"></script>
            <style>
                body {{ margin: 0; padding: 20px; font-family: Arial, sans-serif; }}
                #map {{ height: 500px; width: 100%; border-radius: 10px; margin: 20px 0; }}
                .info {{ background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 10px 0; }}
                .live-indicator {{ background: #ffebee; color: #f44336; padding: 5px 10px; border-radius: 12px; display: inline-block; }}
                button {{ background: #570a1c; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }}
            </style>
        </head>
        <body>
            <h2>📍 Live Location Tracking</h2>
            
            <div class="info">
                <span class="live-indicator">● LIVE</span>
                <p><strong>👤 User:</strong> {session['user_name']}</p>
                <p><strong>🕒 Started:</strong> {session['created_at'][:19].replace('T', ' ')}</p>
                <p><strong>📡 Updates:</strong> <span id="updateCount">{session['total_updates']}</span></p>
                <p><strong>⏱️ Status:</strong> <span id="status">{'Active' if session['is_active'] else 'Inactive'}</span></p>
                {f'<p><strong>⏰ Expires:</strong> {session["expires_at"][:19].replace("T", " ") if session["expires_at"] else "Manual stop"}</p>' if session['expires_at'] else ''}
            </div>
            
            <div id="map"></div>
            
            <div class="info">
                <h3>Latest Location:</h3>
                <div id="latestLocation">
                    {f'<p>📍 Lat: {latest_location["lat"]:.6f}, Lng: {latest_location["lng"]:.6f}</p>' if latest_location else '<p>No location data</p>'}
                    {f'<p>🕒 {latest_location["timestamp"][:19].replace("T", " ")}</p>' if latest_location else ''}
                </div>
            </div>
            
            <button onclick="refreshPage()">🔄 Refresh</button>
            <button onclick="toggleAutoRefresh()" id="autoRefreshBtn">⏯️ Enable Auto-Refresh</button>
            
            <div id="connectionStatus" style="font-size: 12px; color: #666; margin-top: 10px;">
                Connecting to live updates...
            </div>
            
            <script>
                // Initialize map
                var map = L.map('map').setView([{latest_location['lat'] if latest_location else 0}, {latest_location['lng'] if latest_location else 0}], 15);
                L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                    attribution: '© OpenStreetMap contributors'
                }}).addTo(map);
                
                // Add marker
                var marker = L.marker([{latest_location['lat'] if latest_location else 0}, {latest_location['lng'] if latest_location else 0}]).addTo(map);
                marker.bindPopup("<b>{session['user_name']}</b><br>Last updated: {latest_location['timestamp'][:19].replace('T', ' ') if latest_location else 'N/A'}");
                
                // FIXED: WebSocket connection with proper server URL
                var socket = io('{server_url}');
                var sessionId = '{session_id}';
                var autoRefreshEnabled = false;
                
                socket.on('connect', function() {{
                    console.log('✅ Connected to WebSocket');
                    socket.emit('join_session', {{ session_id: sessionId }});
                    document.getElementById('connectionStatus').innerHTML = '✅ Connected to live updates';
                    document.getElementById('connectionStatus').style.color = '#4CAF50';
                }});
                
                // ... rest of your JavaScript ...
            </script>
        </body>
        </html>
        """
        
        return html_content, 200
        
    except Exception as e:
        logger.error(f"View tracking error: {e}")
        return "Error loading tracking page", 500

# WebSocket events
@socketio.on('join_session')
def handle_join_session(data):
    session_id = data.get('session_id')
    if session_id in tracking_sessions:
        active_connections[session_id] = active_connections.get(session_id, 0) + 1
        socketio.emit('session_joined', {'session_id': session_id})

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


@app.route("/debug_url", methods=["GET"])
def debug_url():
    """Debug endpoint to check what URLs are being generated"""
    import socket
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

if __name__ == "__main__":
    logger.info("Starting HerShield backend with WebSocket support...")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)