const mysql = require('mysql2/promise');

const config = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'Admin@123',
};

async function setup() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('Connected to MySQL server.');

    // 1. Create Database
    await connection.query('CREATE DATABASE IF NOT EXISTS emergency_db');
    console.log('Database "emergency_db" created or already exists.');

    // 2. Switch to Database
    await connection.query('USE emergency_db');

    // 3. Create form_types table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS form_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      )
    `);
    console.log('Table "form_types" created.');

    // Seed form_types
    await connection.query('INSERT IGNORE INTO form_types (id, name) VALUES (1, "Registration"), (2, "Assessment")');
    console.log('Seeded "form_types".');

    // 4. Create forms table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        form_type_id INT,
        name VARCHAR(255) NOT NULL,
        unit_type VARCHAR(50) NOT NULL,
        fields JSON NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (form_type_id) REFERENCES form_types(id)
      )
    `);
    console.log('Table "forms" created.');

    // 5. Create form_submissions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS form_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        form_id INT,
        incident_id VARCHAR(255),
        submitted_by VARCHAR(255) DEFAULT 'dispatcher',
        answers JSON NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (form_id) REFERENCES forms(id)
      )
    `);
    console.log('Table "form_submissions" created.');

    // 6. Seed initial forms
    const registrationFields = [
      { id: 'f1', label: 'Patient Name', type: 'text', required: true },
      { id: 'f2', label: 'Phone Number', type: 'tel', required: true },
      { id: 'f3', label: 'Address / Landmark', type: 'text', required: true },
      { id: 'f4', label: 'Age', type: 'number', required: false },
      { id: 'f5', label: 'Severity', type: 'select', required: true, options: ['low', 'medium', 'high', 'critical'] },
      { id: 'f6', label: 'Chief Complaint', type: 'textarea', required: false }
    ];

    const assessmentFields = [
      { id: 's1', label: 'GCS Score', type: 'number', required: true },
      { id: 's2', label: 'Blood Pressure', type: 'text', required: true },
      { id: 's3', label: 'Heart Rate', type: 'number', required: true },
      { id: 's4', label: 'SpO2 (%)', type: 'number', required: true },
      { id: 's5', label: 'Pupil Reaction', type: 'select', required: false, options: ['Normal', 'Sluggish', 'Fixed'] },
      { id: 's6', label: 'Medications Administered', type: 'textarea', required: false }
    ];

    await connection.query(
      'INSERT IGNORE INTO forms (id, form_type_id, name, unit_type, fields, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [1, 1, 'Ambulance Dispatch Form', 'ambulance', JSON.stringify(registrationFields), 1]
    );
    await connection.query(
      'INSERT IGNORE INTO forms (id, form_type_id, name, unit_type, fields, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [2, 2, 'On-Scene Assessment', 'ambulance', JSON.stringify(assessmentFields), 1]
    );
    console.log('Seeded initial forms.');

    console.log('✅ Setup complete!');

  } catch (err) {
    console.error('❌ Error during setup:', err.message);
  } finally {
    if (connection) await connection.end();
    process.exit(0);
  }
}

setup();
