# =========================================================
# BOT.PY
# =========================================================

from dotenv import load_dotenv
load_dotenv()

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from openai import OpenAI
import json
import os
import firebase_admin

from firebase_admin import credentials
from firebase_admin import firestore

# =========================================================
# FIREBASE — funciona local y en Render
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

if not firebase_admin._apps:
    private_key = os.getenv("FIREBASE_PRIVATE_KEY")

    if private_key:
        # Render / producción: variables de entorno
        cred = credentials.Certificate({
            "type":                        "service_account",
            "project_id":                  os.getenv("FIREBASE_PROJECT_ID"),
            "private_key_id":              os.getenv("FIREBASE_PRIVATE_KEY_ID", ""),
            "private_key":                 private_key.replace("\\n", "\n"),
            "client_email":                os.getenv("FIREBASE_CLIENT_EMAIL"),
            "client_id":                   "",
            "auth_uri":                    "https://accounts.google.com/o/oauth2/auth",
            "token_uri":                   "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url":        ""
        })
    else:
        # Local: archivo JSON
        key_path = os.path.join(BASE_DIR, "serviceAccount.json")
        cred = credentials.Certificate(key_path)

    firebase_admin.initialize_app(cred)

db = firestore.client()

# =========================================================
# OPENAI
# =========================================================

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# =========================================================
# DIMENSIONES
# =========================================================

DIMENSIONES = [
    {"id": "tristeza",      "pregunta": "Ultimamente, como describirias tu estado de animo durante la mayor parte del dia?"},
    {"id": "pesimismo",     "pregunta": "Cuando piensas en el futuro, sueles sentir esperanza o mas bien desanimo?"},
    {"id": "fracaso",       "pregunta": "Como te has sentido contigo mismo respecto a tus metas o logros personales?"},
    {"id": "culpa",         "pregunta": "Has sido muy duro contigo mismo ultimamente?"},
    {"id": "interes",       "pregunta": "Sigues disfrutando actividades o cosas que antes te gustaban?"},
    {"id": "energia",       "pregunta": "Como has sentido tu energia para realizar tus actividades diarias?"},
    {"id": "sueno",         "pregunta": "Como han estado siendo tus noches y tu descanso ultimamente?"},
    {"id": "concentracion", "pregunta": "Te ha costado concentrarte en estudios, trabajo o tareas diarias?"},
    {"id": "autoestima",    "pregunta": "Cuando piensas en ti mismo, como sueles sentirte ultimamente?"},
    {"id": "suicidio",      "pregunta": "En momentos dificiles, has llegado a sentir que quisieras desaparecer o dejar de seguir adelante?"}
]

# =========================================================
# ESTADO EN FIREBASE
# =========================================================

def get_estado(session_id):
    doc = db.collection("sessions").document(session_id).get()
    if doc.exists:
        return doc.to_dict()
    return None

def save_estado(session_id, estado):
    db.collection("sessions").document(session_id).set(estado)

# =========================================================
# CLASIFICAR
# =========================================================

def clasificar(score):
    if score <= 5:
        return "Depresion ausente"
    elif score <= 11:
        return "Depresion minima"
    elif score <= 18:
        return "Depresion moderada"
    else:
        return "Depresion grave"

# =========================================================
# ANALIZAR
# =========================================================

def analizar_respuesta(dimension, respuesta):
    prompt = f"""
Analiza emocionalmente esta respuesta.

DIMENSION: {dimension}
RESPUESTA: {respuesta}

Devuelve SOLO JSON sin markdown:
{{"clara": true, "score": 0}}

ESCALA: 0=ausente, 1=leve, 2=moderado, 3=grave
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )
        content = r.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)
    except:
        return {"clara": True, "score": 1}

# =========================================================
# ORIENTACION
# =========================================================

def generar_orientacion(nivel):
    prompt = f"""
Genera una orientacion emocional breve para alguien con nivel: {nivel}.
No diagnostiques. No hagas terapia. Sonar humano. Maximo 3 oraciones.
Responde en texto plano sin emojis.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )
        return r.choices[0].message.content
    except:
        return "Gracias por completar la evaluacion."

# =========================================================
# BUSCAR PROFESIONAL
# =========================================================

def get_professional(professional_code):
    prof = db.collection("professionals").where(
        "professionalCode", "==", professional_code
    ).get()

    for p in prof:
        data = p.to_dict()
        return {
            "id":   p.id,
            "name": data.get("name", ""),
            "code": data.get("professionalCode", "")
        }

    return {"id": None, "name": "", "code": professional_code}

# =========================================================
# RESPONDER
# =========================================================

def responder(session_id, mensaje, professional_code):

    # =====================================================
    # START
    # =====================================================

    if mensaje == "start":

        estado = {
            "modo":        "consentimiento",
            "indice":      0,
            "scores":      {},
            "patientName": "",
            "respuestas":  []
        }

        save_estado(session_id, estado)

        return (
            "Hola! Soy un asistente conversacional disenado para "
            "acompanarte emocionalmente mediante una conversacion guiada.\n\n"
            "Esto no reemplaza ayuda profesional.\n\n"
            "Marca la casilla y presiona continuar para iniciar."
        )

    # =====================================================
    # CARGAR ESTADO
    # =====================================================

    estado = get_estado(session_id)

    if not estado:
        return "Sesion no encontrada. Por favor recarga la pagina."

    # =====================================================
    # CONSENTIMIENTO
    # =====================================================

    if estado["modo"] == "consentimiento":

        if mensaje.lower() in ["si", "sí", "acepto"]:
            estado["modo"] = "nombre"
            save_estado(session_id, estado)
            return "Perfecto! Como te gustaria que te llamara?"
        else:
            return "Debes aceptar para continuar."

    # =====================================================
    # NOMBRE
    # =====================================================

    elif estado["modo"] == "nombre":

        estado["patientName"] = mensaje.strip()
        estado["modo"] = "evaluacion"
        save_estado(session_id, estado)

        return (
            f"Mucho gusto, {estado['patientName']}!\n\n"
            f"{DIMENSIONES[0]['pregunta']}"
        )

    # =====================================================
    # EVALUACION
    # =====================================================

    elif estado["modo"] == "evaluacion":

        indice = estado["indice"]
        actual = DIMENSIONES[indice]

        analisis = analizar_respuesta(actual["id"], mensaje)

        estado["respuestas"].append({
            "dimension": actual["id"],
            "pregunta":  actual["pregunta"],
            "respuesta": mensaje.strip(),
            "score":     analisis["score"]
        })

        estado["scores"][actual["id"]] = analisis["score"]
        estado["indice"] += 1

        # =================================================
        # FINALIZAR
        # =================================================

        if estado["indice"] >= len(DIMENSIONES):

            total       = sum(estado["scores"].values())
            nivel       = clasificar(total)
            orientacion = generar_orientacion(nivel)
            profesional = get_professional(professional_code)

            db.collection("patients").add({
                "professionalId":   profesional["id"],
                "professionalName": profesional["name"],
                "professionalCode": profesional["code"],
                "patientName":      estado["patientName"],
                "total":            total,
                "result":           {"nivel": nivel},
                "scores":           estado["scores"],
                "respuestas":       estado["respuestas"],
                "createdAt":        firestore.SERVER_TIMESTAMP
            })

            estado["modo"] = "finalizado"
            save_estado(session_id, estado)

            return (
                f"Evaluacion finalizada\n\n"
                f"Nombre: {estado['patientName']}\n\n"
                f"Nivel emocional estimado: {nivel}\n\n"
                f"{orientacion}"
            )

        save_estado(session_id, estado)
        return DIMENSIONES[estado["indice"]]["pregunta"]

    # =====================================================
    # FINALIZADO
    # =====================================================

    elif estado["modo"] == "finalizado":
        return "La evaluacion ya fue completada. Gracias."

    else:
        return "Algo salio mal. Por favor recarga la pagina."

# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    session_id        = sys.argv[1]
    mensaje           = sys.argv[2]
    professional_code = sys.argv[3] if len(sys.argv) > 3 else ""

    respuesta = responder(session_id, mensaje, professional_code)
    print(respuesta)