import { OPENAI_KEY } from '$env/static/private';
import type { CreateChatCompletionRequest, ChatCompletionRequestMessage } from 'openai';
import type { RequestHandler } from './$types';
import { getTokens } from '$lib/tokenizer';
import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';

export const config: Config = {
    runtime: 'edge'
};

export const POST: RequestHandler = async ({ request }) => {
    try {
        if (!OPENAI_KEY) {
            throw new Error('No se ha provisto de variable OPEN_AI');
        }

        const requestData = await request.json();

        console.log('requestData:', requestData);

        if (!requestData || !requestData.messages || !Array.isArray(requestData.messages)) {
            console.error('Datos de solicitud incorrectos:', requestData);
            throw new Error('Datos de solicitud incorrectos');
        }

        const reqMessages: ChatCompletionRequestMessage[] = requestData.messages;

        console.log('reqMessages:', reqMessages);

        if (!Array.isArray(reqMessages)) {
            console.error('reqMessages no es un array:', reqMessages);
            throw new Error('reqMessages no es un array');
        }

        if (reqMessages.length === 0) {
            console.error('No se han proporcionado mensajes');
            throw new Error('No se han proporcionado mensajes');
        }

        let tokenCount = 0;

        console.log('Comenzando bucle de mensajes');

        for (let i = 0; i < reqMessages.length; i++) {
            const msg = reqMessages[i];

            if (!msg || typeof msg.content !== 'string') {
                console.error('Mensaje inválido en la posición', i, ':', msg);
                throw new Error('Mensaje inválido en la posición ' + i);
            }

            console.log('Procesando mensaje:', msg);
            const tokens = getTokens(msg.content);
            tokenCount += tokens;
        }

        console.log('Token count después del bucle:', tokenCount);

        const lastMessageContent = reqMessages[reqMessages.length - 1]?.content;

        if (!lastMessageContent || typeof lastMessageContent !== 'string') {
            console.error('Contenido del último mensaje inválido:', lastMessageContent);
            throw new Error('Contenido del último mensaje inválido');
        }

        const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_KEY}`
            },
            method: 'POST',
            body: JSON.stringify({
                input: lastMessageContent
            })
        });

        const moderationData = await moderationRes.json();
        const [results] = moderationData.results || [];

        if (results && results.flagged) {
            throw new Error('Pregunta prohibida por OpenAI. Intenta con otra.');
        }

        const prompt = 'Eres un asistente virtual sin fines de lucro, muy inteligente y dispuesto a ayudar. Tu nombre es Compadre.';
        tokenCount += getTokens(prompt);

        if (tokenCount >= 2048) {
            throw new Error('Respuesta muy larga');
        }

        const messages: ChatCompletionRequestMessage[] = [
            { role: 'system', content: prompt },
            ...reqMessages
        ];

        const chatRequestOpts: CreateChatCompletionRequest = {
            model: 'gpt-3.5-turbo',
            messages,
            temperature: 0.2,
            stream: true
        };

        const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            headers: {
                Authorization: `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify(chatRequestOpts)
        });

        if (!chatResponse.ok) {
            const err = await chatResponse.json();
            console.error('Error en la respuesta de chat:', err);
            throw new Error('Error en la respuesta de chat: ' + JSON.stringify(err));
        }

        return new Response(chatResponse.body, {
            headers: {
                'Content-Type': 'text/event-stream'
            }
        });
    } catch (err) {
        console.error('Error en la ejecución principal:', err);
        return json({ error: 'Hubo un error procesando tu petición' }, { status: 500 });
    }
};
