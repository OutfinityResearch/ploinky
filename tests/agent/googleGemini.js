const { callLLM } = require('../../Agent/LLMClient.js');
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/`;
process.env.LLM_MODEL = "gemini-2.5-flash";
process.env.LLM_API_KEY = "";
process.env.LLM_PROVIDER = "google";
process.env.LLM_BASE_URL = apiUrl + `${process.env.LLM_MODEL}:generateContent?key=${process.env.LLM_API_KEY}`;


let context = []
context.push({ role: 'human', message: "hello" });
callLLM(context).then((aiResponse)=>{
    console.log(aiResponse);
});