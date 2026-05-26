//////////////////////////////////////////////////////////
// SERVER.JS (REVISADO Y CORREGIDO)
//////////////////////////////////////////////////////////

require("dotenv").config();

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { PythonShell } = require("python-shell");

const { db } = require("./firebase");

//////////////////////////////////////////////////////////
// VALIDACIÓN DE VARIABLES DE ENTORNO AL ARRANQUE
//////////////////////////////////////////////////////////

if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET no está definido. Abortando.");
    process.exit(1);
}

if (!process.env.FIREBASE_PRIVATE_KEY) {
    console.error("FATAL: FIREBASE_PRIVATE_KEY no está definida. Abortando.");
    process.exit(1);
}

//////////////////////////////////////////////////////////
// APP
//////////////////////////////////////////////////////////

const app = express();

//////////////////////////////////////////////////////////
// MIDDLEWARE
//////////////////////////////////////////////////////////

app.use(cors());
app.use(express.json());

//////////////////////////////////////////////////////////
// DEBUG (solo en desarrollo)
//////////////////////////////////////////////////////////

if (process.env.NODE_ENV !== "production") {
    console.log("SERVER INICIADO EN MODO DESARROLLO");
    console.log("JWT_SECRET:", process.env.JWT_SECRET ? "OK" : "MISSING");
    console.log("FIREBASE:", !!process.env.FIREBASE_PRIVATE_KEY);
}

//////////////////////////////////////////////////////////
// AUTH MIDDLEWARE
//////////////////////////////////////////////////////////

function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Token no proporcionado" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error("JWT ERROR:", err.message);
        return res.status(401).json({ error: "Token inválido o expirado" });
    }
}

//////////////////////////////////////////////////////////
// REGISTER
//////////////////////////////////////////////////////////

app.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "Faltan datos: name, email y password son requeridos" });
        }

        // Validación básica de formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: "Formato de email inválido" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
        }

        const exists = await db.collection("professionals")
            .where("email", "==", email)
            .get();

        if (!exists.empty) {
            return res.status(409).json({ error: "Correo ya registrado" });
        }

        const hashed = await bcrypt.hash(password, 10);

        // Generar professionalCode único con verificación
        let professionalCode;
        let codeExists = true;
        while (codeExists) {
            professionalCode = "PRO-" + Math.floor(10000 + Math.random() * 90000);
            const codeSnap = await db.collection("professionals")
                .where("professionalCode", "==", professionalCode)
                .get();
            codeExists = !codeSnap.empty;
        }

        const uid = crypto.randomUUID();

        await db.collection("professionals").doc(uid).set({
            name,
            email,
            password: hashed,
            professionalCode,
            createdAt: new Date()
        });

        res.status(201).json({ success: true, professionalCode });

    } catch (err) {
        console.error("REGISTER ERROR:", err);
        res.status(500).json({ error: "Error interno al registrar" });
    }
});

//////////////////////////////////////////////////////////
// LOGIN
//////////////////////////////////////////////////////////

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email y password son requeridos" });
        }

        const snap = await db.collection("professionals")
            .where("email", "==", email)
            .get();

        // Mensaje genérico para no revelar si el email existe o no
        if (snap.empty) {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

        const doc = snap.docs[0];
        const data = doc.data();

        const match = await bcrypt.compare(password, data.password);

        if (!match) {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

        const token = jwt.sign(
            { id: doc.id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            token,
            professionalId: doc.id,
            name: data.name,
            professionalCode: data.professionalCode
        });

    } catch (err) {
        console.error("LOGIN ERROR:", err);
        res.status(500).json({ error: "Error interno al iniciar sesión" });
    }
});

//////////////////////////////////////////////////////////
// PROFESSIONAL
// NOTA: Endpoint público — no expone password
//////////////////////////////////////////////////////////

app.get("/professional/:code", async (req, res) => {
    try {
        const { code } = req.params;

        if (!code) {
            return res.status(400).json({ error: "Código requerido" });
        }

        const snap = await db.collection("professionals")
            .where("professionalCode", "==", code)
            .get();

        if (snap.empty) {
            return res.status(404).json({ error: "Profesional no encontrado" });
        }

        const doc = snap.docs[0];
        const { password, ...safeData } = doc.data(); // ← nunca exponer el hash

        res.json({ id: doc.id, ...safeData });

    } catch (err) {
        console.error("PROFESSIONAL ERROR:", err);
        res.status(500).json({ error: "Error interno al buscar profesional" });
    }
});

//////////////////////////////////////////////////////////
// PATIENTS
// Solo el profesional autenticado puede ver sus propios pacientes
//////////////////////////////////////////////////////////

app.get("/patients/:professionalId", auth, async (req, res) => {
    try {
        // Verificar que el usuario autenticado es el dueño del recurso
        if (req.user.id !== req.params.professionalId) {
            return res.status(403).json({ error: "Acceso no autorizado a estos pacientes" });
        }

        const snap = await db.collection("patients")
            .where("professionalId", "==", req.params.professionalId)
            .get();

        const patients = snap.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        res.json(patients);

    } catch (err) {
        console.error("PATIENTS ERROR:", err);
        res.status(500).json({ error: "Error interno al obtener pacientes" });
    }
});

//////////////////////////////////////////////////////////
// CHAT — Ejecuta bot.py con PythonShell
//////////////////////////////////////////////////////////

app.post("/chat", auth, async (req, res) => {
    try {
        const { sessionId, message, professionalCode } = req.body;

        if (!sessionId) {
            return res.status(400).json({ reply: "sessionId es requerido" });
        }

        const options = {
            mode: "text",
            pythonPath: "python3",
            scriptPath: __dirname,
            args: [
                sessionId,
                message || "",
                professionalCode || ""
            ]
        };

        const result = await PythonShell.run("bot.py", options);

        return res.json({
            reply: result?.join("\n") || "Sin respuesta del bot"
        });

    } catch (err) {
        console.error("CHAT / PYTHON ERROR:", err);
        return res.status(500).json({ reply: "Error al procesar la solicitud del bot" });
    }
});

//////////////////////////////////////////////////////////
// STATIC
//////////////////////////////////////////////////////////

app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

//////////////////////////////////////////////////////////
// 404 — Ruta no encontrada
//////////////////////////////////////////////////////////

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

//////////////////////////////////////////////////////////
// ERROR HANDLER GLOBAL
//////////////////////////////////////////////////////////

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("ERROR GLOBAL:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

//////////////////////////////////////////////////////////
// SERVER
//////////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});