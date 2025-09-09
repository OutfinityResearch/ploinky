const { callLLM } = require('../../Agent/LLMClient.js');
process.env.LLM_BASE_URL = "https://api.openai.com/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_PROVIDER = "openai";

let context = []
context.push({ role: 'human', message: "hello" });
callLLM(context).then((aiResponse)=>{
    console.log(aiResponse);
});
