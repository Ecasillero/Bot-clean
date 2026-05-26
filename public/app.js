// REGISTER
async function register() {
    const name     = document.getElementById("name")?.value;
    const email    = document.getElementById("email")?.value;
    const password = document.getElementById("password")?.value;

    const r = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
    });

    const data = await r.json();

    if (data.success) {
        alert("Cuenta creada");
        window.location = "login.html";
    } else {
        alert(data.error);
    }
}

// LOGIN
async function login() {
    const email    = document.getElementById("email")?.value;
    const password = document.getElementById("password")?.value;

    const r = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });

    const data = await r.json();

    if (data.token) {
        localStorage.setItem("token",            data.token);
        localStorage.setItem("professionalId",   data.professionalId);
        localStorage.setItem("name",             data.name);
        localStorage.setItem("professionalCode", data.professionalCode);
        window.location = "dashboard.html";
    } else {
        alert(data.error);
    }
}

// DASHBOARD
if (window.location.pathname.includes("dashboard")) {
    const welcome = document.getElementById("welcome");
    const link    = document.getElementById("link");

    if (welcome) {
        welcome.innerText = "Bienvenido " + localStorage.getItem("name");
    }

    if (link) {
        link.value = window.location.origin + "/evaluation.html?code=" + localStorage.getItem("professionalCode");
    }

    loadPatients();
}

// COPIAR LINK
function copyLink() {
    const input = document.getElementById("link");
    if (!input) return;
    navigator.clipboard.writeText(input.value);
    alert("Copiado");
}

// BADGE DE NIVEL
function nivelBadgeClass(nivel) {
    if (!nivel) return "";
    const n = nivel.toLowerCase();
    if (n.includes("ausente"))  return "ausente";
    if (n.includes("minima"))   return "minima";
    if (n.includes("moderada")) return "moderada";
    if (n.includes("grave"))    return "grave";
    return "";
}

// SCORE LABEL
function scoreLabel(score) {
    const labels = ["Ausente", "Leve", "Moderado", "Grave"];
    return labels[score] || "?";
}

// PACIENTES
async function loadPatients() {
    const div = document.getElementById("patients");
    if (!div) return;

    // Mostrar loading
    div.innerHTML = `
        <div class="loading-row">
            <span class="spinner"></span>
            Cargando pacientes...
        </div>
    `;

    try {
        const professionalCode = localStorage.getItem("professionalCode");
        const token            = localStorage.getItem("token");

        const prof     = await fetch("/professional/" + professionalCode);
        const profData = await prof.json();

        const r = await fetch("/patients/" + profData.id, {
            headers: { Authorization: token }
        });

        const patients = await r.json();

        div.innerHTML = "";

        if (!patients.length) {
            div.innerHTML = "<p style='color:#94a3b8; font-size:14px; padding:10px 0;'>No hay pacientes aun.</p>";
            return;
        }

        patients.forEach((p, i) => {
            const nivel      = p.result?.nivel || "Sin clasificar";
            const badgeClass = nivelBadgeClass(nivel);
            const respuestas = p.respuestas || [];

            const respuestasHTML = respuestas.map(r => `
                <div class="respuesta-item">
                    <div class="pregunta">${r.pregunta}</div>
                    <div class="respuesta">"${r.respuesta}"</div>
                    <div class="score">
                        <span class="score-dot score-${r.score}"></span>
                        ${r.dimension} — ${scoreLabel(r.score)}
                    </div>
                </div>
            `).join("");

            const card = document.createElement("div");
            card.className = "patient-card";
            card.innerHTML = `
                <div class="patient-header" onclick="togglePatient(${i})">
                    <h3>${p.patientName || "Paciente"}</h3>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="nivel-badge ${badgeClass}">${nivel}</span>
                        <span class="patient-arrow" id="arrow-${i}">▼</span>
                    </div>
                </div>
                <div class="patient-detail" id="detail-${i}">
                    <div class="patient-meta">
                        <span><strong>Puntaje total:</strong> ${p.total ?? "—"}</span>
                        <span><strong>Profesional:</strong> ${p.professionalName || "—"}</span>
                    </div>
                    ${respuestasHTML || "<p style='color:#94a3b8;font-size:13px;'>Sin respuestas registradas.</p>"}
                </div>
            `;

            div.appendChild(card);
        });

    } catch (err) {
        div.innerHTML = "<p style='color:#f87171; font-size:14px;'>Error cargando pacientes.</p>";
        console.error(err);
    }
}

// TOGGLE PACIENTE
function togglePatient(i) {
    const detail = document.getElementById("detail-" + i);
    const arrow  = document.getElementById("arrow-"  + i);
    if (!detail) return;
    const isOpen = detail.classList.contains("open");
    detail.classList.toggle("open", !isOpen);
    arrow.classList.toggle("open",  !isOpen);
}

// CHAT IA
if (window.location.pathname.includes("evaluation")) {
    const params           = new URLSearchParams(window.location.search);
    const professionalCode = params.get("code");
    const sessionId        = crypto.randomUUID();
    const chat             = document.getElementById("chat");
    const input            = document.getElementById("message");

    function addMessage(text, sender) {
        const div      = document.createElement("div");
        div.className  = "message " + sender;
        div.innerText  = text;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function showTyping() {
        const t = document.createElement("div");
        t.className = "typing-indicator";
        t.id        = "typing";
        t.innerHTML = "<span></span><span></span><span></span>";
        chat.appendChild(t);
        chat.scrollTop = chat.scrollHeight;
    }

    function hideTyping() {
        const t = document.getElementById("typing");
        if (t) t.remove();
    }

    window.sendMessage = async function () {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, "user");
        input.value = "";

        showTyping();

        try {
            const res = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, message: text, professionalCode })
            });

            const data = await res.json();
            hideTyping();
            addMessage(data.reply, "bot");
        } catch (err) {
            hideTyping();
            console.log(err);
            alert("Error enviando mensaje");
        }
    };

    if (input) {
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") sendMessage();
        });
    }

    window.startEvaluation = async function () {
        try {
            const consent = document.getElementById("consent");

            if (!consent.checked) {
                alert("Debes aceptar continuar.");
                return;
            }

            document.getElementById("consentBox").style.display = "none";
            document.getElementById("inputArea").style.display  = "flex";

            showTyping();

            const res = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, message: "acepto", professionalCode })
            });

            const data = await res.json();
            hideTyping();
            addMessage(data.reply, "bot");
        } catch (err) {
            hideTyping();
            console.log(err);
            alert("Error iniciando evaluacion");
        }
    };

    window.addEventListener("load", async () => {
        try {
            const res = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, message: "start", professionalCode })
            });

            if (!res.ok) {
                throw new Error("HTTP ERROR " + res.status);
            }

            const data = await res.json();
            addMessage(data.reply, "bot");
            document.getElementById("consentBox").style.display = "block";
        } catch (err) {
            console.error("ERROR:", err);
            alert(err.message);
        }
    });
}