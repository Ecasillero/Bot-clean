//////////////////////////////////////////////////////////
// SERVER.JS
//////////////////////////////////////////////////////////

require("dotenv").config();

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
// ❌ PythonShell DESACTIVADO (causa #1 de 500 en Render)
// const { PythonShell } = require("python-shell");

const { db } = require("./firebase");

const app = express();

//////////////////////////////////////////////////////////
// MIDDLEWARE
//////////////////////////////////////////////////////////

app.use(cors());
app.use(express.json());

//////////////////////////////////////////////////////////
// DEBUG
//////////////////////////////////////////////////////////

console.log("SERVER INICIADO");
console.log("JWT:", process.env.JWT_SECRET ? "OK" : "MISSING");
console.log("FIREBASE KEY:", !!process.env.FIREBASE_PRIVATE_KEY);

//////////////////////////////////////////////////////////
// AUTH
//////////////////////////////////////////////////////////

function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error("JWT ERROR:", err);
        return res.status(401).json({ error: "Token inválido" });
    }
}

//////////////////////////////////////////////////////////
// REGISTER
//////////////////////////////////////////////////////////

app.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const exists = await db.collection("professionals")
            .where("email", "==", email)
            .get();

        if (!exists.empty) {
            return res.status(400).json({ error: "Correo ya registrado" });
        }

        const hashed = await bcrypt.hash(password, 10);
        const professionalCode = "PRO-" + Math.floor(10000 + Math.random() * 90000);
        const uid = crypto.randomUUID();

        await db.collection("professionals").doc(uid).set({
            name,
            email,
            password: hashed,
            professionalCode,
            createdAt: new Date()
        });

        res.json({ success: true, professionalCode });

    } catch (err) {
        console.error("REGISTER ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// LOGIN
//////////////////////////////////////////////////////////

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const snap = await db.collection("professionals")
            .where("email", "==", email)
            .get();

        if (snap.empty) {
            return res.status(400).json({ error: "No existe usuario" });
        }

        const doc = snap.docs[0];
        const data = doc.data();

        const match = await bcrypt.compare(password, data.password);

        if (!match) {
            return res.status(400).json({ error: "Password incorrecto" });
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
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// PROFESSIONAL
//////////////////////////////////////////////////////////

app.get("/professional/:code", async (req, res) => {
    try {
        const snap = await db.collection("professionals")
            .where("professionalCode", "==", req.params.code)
            .get();

        if (snap.empty) {
            return res.status(404).json({ error: "No encontrado" });
        }

        const doc = snap.docs[0];
        res.json({ id: doc.id, ...doc.data() });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// PATIENTS
//////////////////////////////////////////////////////////

app.get("/patients/:professionalId", auth, async (req, res) => {
    try {
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
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// CHAT (TEMPORAL SIN PYTHON - EVITA 500)
//////////////////////////////////////////////////////////

app.post("/chat", async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        if (!sessionId) {
            return res.status(400).json({ reply: "sessionId requerido" });
        }

        // 🔥 RESPUESTA SIMPLE (EVITA CRASH EN RENDER)
        return res.json({
            reply: `IA activa: recibí -> ${message}`
        });

    } catch (err) {
        console.error("CHAT ERROR:", err);
        res.status(500).json({ reply: err.message });
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
// ERROR HANDLER (IMPORTANTE)
//////////////////////////////////////////////////////////

app.use((err, req, res, next) => {
    console.error("🔥 ERROR GLOBAL:", err);
    res.status(500).json({
        error: err.message
    });
});

//////////////////////////////////////////////////////////
// SERVER
//////////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor en puerto", PORT);
});