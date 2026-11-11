CREATE DATABASE IF NOT EXISTS delsol_db;
USE delsol_db;

CREATE TABLE IF NOT EXISTS tipos_cambio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    precio_compra DECIMAL(10, 4) NOT NULL,
    precio_venta DECIMAL(10, 4) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar un valor inicial por defecto (opcional)
INSERT INTO tipos_cambio (precio_compra, precio_venta) VALUES (19.8000, 20.2000);
