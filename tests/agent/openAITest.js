const { callLLM } = require('../../Agent/LLMClient.js');
const {callLLMWithModel} = require("../../Agent/LLMClient");
process.env.LLM_BASE_URL = "https://api.openai.com/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_PROVIDER = "openai";

let context = []
callLLM(context, "hello").then((aiResponse)=>{
    console.log(aiResponse);
});

callLLMWithModel("gpt-4o-mini", context, "hello").then((aiResponse)=>{
    console.log(aiResponse);
});