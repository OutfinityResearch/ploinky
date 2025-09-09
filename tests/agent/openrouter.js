const { callLLM } = require('../../Agent/LLMClient.js');
process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_PROVIDER = "openrouter";

let context = []
context.push({ role: 'human', message: "hello" });
callLLM(context).then((aiResponse)=>{
    console.log(aiResponse);
});
