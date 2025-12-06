-- Create users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    email_id VARCHAR(120) UNIQUE NOT NULL,
    mobile_no VARCHAR(20),
    birth_date DATE NULL,
    password_hash VARCHAR(255) NOT NULL,
    address_line_1 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


-- Create trusted contacts table
CREATE TABLE trusted_contacts (
    contact_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    contact_name VARCHAR(100) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    relationship VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


CREATE TABLE sos_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    TIMESTAMP DATETIME DEFAULT CURRENT_TIMESTAMP,
    trigger_type VARCHAR(50) NULL,   -- 'manual', 'auto', 'voice_auto', 'shake', etc.
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    location VARCHAR(255) NULL,      -- fallback string if GPS missing
    message TEXT NULL,               -- full SOS alert message
    recipients VARCHAR(255) NULL,    -- comma-separated phone numbers
    sms_status VARCHAR(50) NULL,     -- 'sent', 'delivered', 'failed', etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- Create incident_reports table (PUBLIC - displayed to all users, anonymous)
-- Used for routing/safety calculations and public incident awareness
CREATE TABLE incident_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,  -- Stored but NOT displayed publicly (for analytics only)
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    severity INT NOT NULL DEFAULT 1,  -- 1=Low, 2=Medium, 3=High, 4=Critical
    incident_type VARCHAR(50) NOT NULL,  -- e.g., 'harassment', 'theft', 'assault', 'suspicious_activity'
    DESCRIPTION TEXT,
    place_name VARCHAR(255) NULL,
    location_type VARCHAR(20) DEFAULT 'gps_auto',  -- 'gps_auto', 'gps_manual', 'address_search'
    is_verified BOOLEAN DEFAULT FALSE,  -- For moderation/verification
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_lat_lng (latitude, longitude),
    INDEX idx_created_at (created_at),
    INDEX idx_severity (severity),
    INDEX idx_type (incident_type),
    INDEX idx_verified (is_verified),
    INDEX idx_location_type (location_type)
);


-- Trigger to limit trusted contacts to 5 per user
DELIMITER $$

CREATE TRIGGER limit_contacts_per_user
BEFORE INSERT ON trusted_contacts
FOR EACH ROW
BEGIN
    DECLARE contact_count INT;

    SELECT COUNT(*) INTO contact_count
    FROM trusted_contacts
    WHERE user_id = NEW.user_id;

    IF contact_count >= 5 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Maximum trusted contacts limit reached (5 per user)';
    END IF;
END$$

DELIMITER ;
