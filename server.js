//////////////////////////////////////////////////////////
// SERVER.JS
//////////////////////////////////////////////////////////

require("dotenv").config();

const express    = require("express");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const path       = require("path");
const crypto     = require("crypto");
const { PythonShell } = require("python-shell");

const db = require("./firebase");
console.log("Firebase cargado:", !!db);

const app = express();

//////////////////////////////////////////////////////////
// MIDDLEWARES
//////////////////////////////////////////////////////////

app.use(cors());
app.use(express.json());

//////////////////////////////////////////////////////////
// DEBUG
//////////////////////////////////////////////////////////

console.log("INICIANDO SERVER...");
console.log("DIRECTORIO:", __dirname);

//////////////////////////////////////////////////////////
// JWT
//////////////////////////////////////////////////////////

function auth(req, res, next) {

    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({ error: "No autorizado" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.log(err);
        return res.status(401).json({ error: "Token inválido" });
    }
}

//////////////////////////////////////////////////////////
// REGISTER
//////////////////////////////////////////////////////////

app.post("/register", async (req, res) => {
    console.log("REGISTER HIT", req.body);
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

        const professionalCode =
            "PRO-" + Math.floor(10000 + Math.random() * 90000);

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
        console.log("ERROR REGISTER:", err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// LOGIN
//////////////////////////////////////////////////////////

app.post("/login", async (req, res) => {
    console.log("LOGIN HIT", req.body);
    try {

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const snap = await db.collection("professionals")
            .where("email", "==", email)
            .get();

        if (snap.empty) {
            return res.status(400).json({ error: "Correo no registrado" });
        }

        const doc   = snap.docs[0];
        const data  = doc.data();

        const match = await bcrypt.compare(password, data.password);

        if (!match) {
            return res.status(400).json({ error: "Contraseña incorrecta" });
        }

        const token = jwt.sign(
            { id: doc.id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            token,
            professionalId:   doc.id,
            name:             data.name,
            professionalCode: data.professionalCode
        });

    } catch (err) {
        console.log("ERROR LOGIN:", err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// PROFESSIONAL BY CODE
//////////////////////////////////////////////////////////

app.get("/professional/:code", async (req, res) => {
    console.log("PROFESSIONAL HIT", req.params);
    try {

        const { code } = req.params;

        const snap = await db.collection("professionals")
            .where("professionalCode", "==", code)
            .get();

        if (snap.empty) {
            return res.status(404).json({ error: "Profesional no encontrado" });
        }

        const doc = snap.docs[0];

        res.json({ id: doc.id, ...doc.data() });

    } catch (err) {
        console.log("ERROR PROFESSIONAL:", err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// PATIENTS
//////////////////////////////////////////////////////////

app.get("/patients/:professionalId", auth, async (req, res) => {
    console.log("PATIENTS HIT", req.params);
    try {

        const { professionalId } = req.params;

        const snap = await db.collection("patients")
            .where("professionalId", "==", professionalId)
            .get();

        const patients = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json(patients);

    } catch (err) {
        console.log("ERROR PATIENTS:", err);
        res.status(500).json({ error: err.message });
    }
});

//////////////////////////////////////////////////////////
// CHAT
//////////////////////////////////////////////////////////

console.log("RUTA /chat REGISTRADA");

app.post("/chat", async (req, res) => {
    console.log("CHAT HIT", req.body);
    try {

        const { sessionId, message, professionalCode } = req.body;

        if (!sessionId) {
            return res.status(400).json({ reply: "SessionId requerido" });
        }

        const options = {
            mode:          "text",
            pythonPath:    "python",
            pythonOptions: ["-u"],
            scriptPath:    __dirname,
            args: [
                String(sessionId),
                String(message        || ""),
                String(professionalCode || "")
            ]
        };

        console.log("EJECUTANDO PYTHON...");

        PythonShell.run("bot.py", options)
            .then(results => {
                console.log("RESULTADOS PYTHON:", results);
                res.json({
                    reply: results && results.length
                        ? results.join("\n")
                        : "Sin respuesta"
                });
            })
            .catch(err => {
                console.log("ERROR PYTHON:", err);
                res.status(500).json({ reply: err.message || "Error ejecutando IA" });
            });

    } catch (err) {
        console.log("ERROR CHAT:", err);
        res.status(500).json({ reply: err.message || "Error del servidor" });
    }
});

//////////////////////////////////////////////////////////
// STATIC FILES  ← SIEMPRE DESPUÉS DE LAS RUTAS API
//////////////////////////////////////////////////////////

app.use(express.static(path.join(__dirname, "../public")));

//////////////////////////////////////////////////////////
// HOME (fallback)
//////////////////////////////////////////////////////////

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

//////////////////////////////////////////////////////////
// SERVER
//////////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor iniciado en puerto " + PORT);
});