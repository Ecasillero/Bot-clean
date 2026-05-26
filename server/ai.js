const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function analizarRespuesta(
    dimension,
    respuesta
){

    const prompt = `
Analiza esta respuesta emocional.

DIMENSION:
${dimension}

RESPUESTA:
${respuesta}

Devuelve SOLO JSON:

{
 "score":0,
 "clara":true
}

0=ausente
1=leve
2=moderado
3=grave
`;

    const r =
    await client.chat.completions.create({

        model:"gpt-4o-mini",

        messages:[
            {
                role:"user",
                content:prompt
            }
        ],

        temperature:0
    });

    try{

        return JSON.parse(
            r.choices[0].message.content
        );

    }catch{

        return {
            score:1,
            clara:true
        };
    }
}

module.exports = {
    analizarRespuesta
};