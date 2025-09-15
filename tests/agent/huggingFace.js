const { callLLM } = require('../../Agent/LLMClient.js');
process.env.LLM_BASE_URL = "https://api-inference.huggingface.co/models/distilgpt2";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "mistralai/Mistral-7B-Instruct-v0.1";
process.env.LLM_PROVIDER = "huggingFace";

let context = []
callLLM(context, "hello").then((aiResponse)=>{
    console.log(aiResponse);
});
