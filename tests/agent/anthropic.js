const { callLLM } = require('../../Agent/LLMClient.js');
process.env.LLM_BASE_URL = "https://api.anthropic.com/v1/messages";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "claude-sonnet-4-20250514";
process.env.LLM_PROVIDER = "anthropic";

let context = []
callLLM(context, "hello").then((aiResponse)=>{
    console.log(aiResponse);
});