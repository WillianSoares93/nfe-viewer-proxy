// server.js

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Para requisições HTTP no backend
const multer = require('multer'); // Para lidar com upload de arquivos (printscreen)
const nodemailer = require('nodemailer'); // Para enviar e-mails
const { IncomingForm } = require('formidable'); // Para parsear form-data com campos e arquivos

const app = express();
const port = process.env.PORT || 3001; // Porta do seu servidor, pode ser 3001 ou outra

// Configuração do Multer para lidar com uploads de arquivos
const upload = multer(); // Não salva em disco, apenas em memória (req.files)

// Middleware para permitir CORS (Cross-Origin Resource Sharing)
// Isso é crucial para que seu frontend possa se comunicar com este backend
app.use(cors());
app.use(express.json()); // Para parsear JSON bodies
app.use(express.urlencoded({ extended: true })); // Para parsear URL-encoded bodies

// URL base da API FSist (se ela for externa e precisar de proxy)
const FSIST_API_BASE_URL = 'https://api.fsist.com.br'; // Exemplo, substitua pela URL real da FSist
const RECAPTCHA_SECRET_KEY = 'SUA_CHAVE_SECRETA_RECAPTCHA'; // <-- SUBSTITUA PELA SUA CHAVE SECRETA DO reCAPTCHA

// --- Endpoint para proxy da API FSist (agora para consulta de chave) ---
app.post('/proxy-fsist-consultar-chave', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-fsist-consultar-chave');
    const { default: fetch } = await import('node-fetch');
    const { FormData, File } = await import('formdata-node');

    // Usar formidable para parsear o corpo da requisição que pode conter form-data
    const form = new IncomingForm({
        multiples: false,
        fileWriteStreamHandler: (file) => {
            const buffers = [];
            const writable = new (require('stream').Writable)();
            writable._write = (chunk, encoding, callback) => {
                buffers.push(chunk);
                callback();
            };
            file.on('end', () => {
                file.buffer = Buffer.concat(buffers);
            });
            return writable;
        }
    });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error("Proxy: Erro ao parsear formulário:", err);
            return res.status(500).json({ error: 'Erro interno do servidor ao processar o upload.' });
        }

        // Extrai a chave, o tipo de documento e o token do reCAPTCHA dos fields
        const chave = fields.chave ? (Array.isArray(fields.chave) ? fields.chave[0] : fields.chave) : '';
        const tipoDocumento = fields.tipoDocumento ? (Array.isArray(fields.tipoDocumento) ? fields.tipoDocumento[0] : fields.tipoDocumento) : 'NFe';
        const recaptchaToken = fields.token ? (Array.isArray(fields.token) ? fields.token[0] : fields.token) : '';

        if (!chave || chave.length !== 44) {
            console.error("Proxy: Chave de acesso inválida ou ausente.");
            return res.status(400).json({ error: 'Chave de acesso inválida ou ausente.' });
        }
        if (!recaptchaToken) {
            console.error("Proxy: Token reCAPTCHA ausente.");
            return res.status(400).json({ error: 'Token reCAPTCHA ausente.' });
        }

        console.log(`Proxy: Chave recebida: ${chave}, Tipo: ${tipoDocumento}, Token reCAPTCHA: ${recaptchaToken.substring(0, 10)}...`);

        try {
            // 1. Verificar o token reCAPTCHA com a Google
            const recaptchaVerifyUrl = `https://www.google.com/recaptcha/api/siteverify`;
            const recaptchaFormData = new URLSearchParams();
            recaptchaFormData.append('secret', RECAPTCHA_SECRET_KEY);
            recaptchaFormData.append('response', recaptchaToken);

            const recaptchaResponse = await fetch(recaptchaVerifyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: recaptchaFormData.toString()
            });

            const recaptchaData = await recaptchaResponse.json();
            console.log("Proxy: Resposta reCAPTCHA:", recaptchaData);

            if (!recaptchaData.success) {
                console.error("Proxy: Verificação reCAPTCHA falhou:", recaptchaData['error-codes']);
                return res.status(403).json({ error: 'Verificação reCAPTCHA falhou.', details: recaptchaData['error-codes'] });
            }

            // 2. Chamar a API FSist para gerar PDF/XML
            const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
            let apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
            
            apiUrlFsist += `&chave=${encodeURIComponent(chave)}`;
            apiUrlFsist += `&captcha=${encodeURIComponent(recaptchaToken)}`; // FSist espera o token reCAPTCHA como 'captcha'
            apiUrlFsist += `&cte=${tipoDocumento === 'CTe' ? '1' : '0'}`;

            console.log(`Proxy: Enviando para FSist: ${apiUrlFsist}`);
            const responseFsist = await fetch(apiUrlFsist, {
                method: "GET", // A FSist parece usar GET para esta consulta
            });

            console.log(`Proxy: Resposta da FSist Status: ${responseFsist.status}`);

            const responseTextFsist = await responseFsist.text();
            console.log(`Proxy: Resposta bruta da FSist (início): ${responseTextFsist.substring(0, 500)}...`);

            if (!responseFsist.ok) {
                console.error(`Proxy: Erro da API FSist: ${responseFsist.status} - ${responseTextFsist}`);
                if (responseTextFsist.trim().startsWith('<!DOCTYPE html>')) {
                    return res.status(502).json({
                        error: `API FSist retornou uma página HTML de erro (Status: ${responseFsist.status}).`,
                        details: responseTextFsist.substring(0, 500) + '...'
                    });
                }
                return res.status(responseFsist.status).json({
                    error: `Erro da API FSist: ${responseFsist.status} ${responseFsist.statusText}`,
                    details: responseTextFsist
                });
            }

            // A resposta da FSist pode ser um JS object string, tentar parsear
            const jsonMatchFsist = responseTextFsist.match(/{.*}/s);

            if (!jsonMatchFsist) {
                console.error("Proxy: Resposta da API FSist não contém um JSON válido ou está vazia após tentativa de extração.");
                return res.status(500).json({ error: "Resposta da API FSist não contém um JSON válido." });
            }

            const resultDataFsist = JSON.parse(jsonMatchFsist[0]);
            console.log("Proxy: Resposta da API FSist (JSON parseado):", resultDataFsist);

            // Adapte a resposta para o frontend, incluindo linkPDF e linkXML
            if (resultDataFsist.Resultado === "OK" && resultDataFsist.id && resultDataFsist.Arquivo) {
                 // Se o FSist retornar um ID e nome de arquivo, construa os links de download
                const downloadPdfLink = `${req.protocol}://${req.get('host')}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.Arquivo)}.pdf`;
                const downloadXmlLink = `${req.protocol}://${req.get('host')}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.Arquivo)}.xml`;

                res.json({
                    status: 'OK',
                    linkPDF: downloadPdfLink,
                    linkXML: downloadXmlLink
                });
            } else {
                res.status(500).json({ status: 'ERROR', message: resultDataFsist.message || 'Resposta inesperada da API FSist.', details: resultDataFsist });
            }

        } catch (error) {
            console.error("Proxy: Erro interno no try-catch do proxy ao consultar chave:", error);
            res.status(500).json({ error: 'Erro interno do servidor ao consultar a chave.', details: error.message });
        }
    });
});

// Endpoint para download de ZIP da FSist (permanece o mesmo)
app.get('/proxy-fsist-downloadzip', async (req, res) => {
    try {
        const { id, arq } = req.query;
        if (!id || !arq) {
            return res.status(400).json({ error: 'Parâmetros "id" e "arq" são obrigatórios.' });
        }

        const downloadUrl = `${FSIST_API_BASE_URL}/api/downloadZip?id=${id}&arq=${arq}`; // Ajuste o endpoint da FSist

        const zipResponse = await fetch(downloadUrl);

        if (!zipResponse.ok) {
            const errorText = await zipResponse.text();
            console.error('Erro ao baixar ZIP da FSist:', zipResponse.status, errorText);
            return res.status(zipResponse.status).json({ error: `Erro ao baixar ZIP da API FSist: ${errorText}` });
        }

        // Define o tipo de conteúdo para zip e envia o arquivo
        res.setHeader('Content-Type', 'application/zip');
        zipResponse.body.pipe(res); // Transfere o stream do zip diretamente para a resposta

    } catch (error) {
        console.error('Erro no download do ZIP via proxy:', error);
        res.status(500).json({ error: 'Erro interno no servidor ao baixar o arquivo ZIP.' });
    }
});


// --- ENDPOINT PARA ENVIO DE E-MAIL (permanece o mesmo) ---
app.post('/send-contact-email', upload.array('arquivo'), async (req, res) => {
    try {
        const { email, pagina, motivo, descricao } = req.body;

        if (!email || !motivo || !descricao) {
            return res.status(400).json({ status: 'ERROR', message: 'Campos obrigatórios ausentes: email, motivo, descrição.' });
        }
        if (email.indexOf("@") === -1) {
            return res.status(400).json({ status: 'ERROR', message: 'Formato de e-mail inválido.' });
        }
        if (motivo === 'Motivo do Contato') {
            return res.status(400).json({ status: 'ERROR', message: 'Selecione um motivo de contato válido.' });
        }

        const attachments = [];
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                attachments.push({
                    filename: file.originalname,
                    content: file.buffer,
                    contentType: file.mimetype
                });
            });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'SEU_EMAIL@gmail.com', // Seu e-mail que enviará a mensagem
                pass: 'SUA_SENHA_DE_APP_OU_SENHA_NORMAL' // Senha de app ou senha do e-mail
            }
        });

        const mailOptions = {
            from: 'SEU_EMAIL@gmail.com',
            to: 'cwsm1993@gmail.com',
            subject: `Contato NF-e Viewer: ${motivo}`,
            html: `
                <p><strong>De:</strong> ${email}</p>
                <p><strong>Motivo do Contato:</strong> ${motivo}</p>
                <p><strong>Página de Origem:</strong> ${pagina || 'Não informada'}</p>
                <hr>
                <p><strong>Descrição:</strong></p>
                <p>${descricao}</p>
            `,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);

        res.json({ status: 'OK', message: 'Mensagem enviada com sucesso!' });

    } catch (error) {
        console.error('Erro ao enviar e-mail de contato:', error);
        res.status(500).json({ status: 'ERROR', message: 'Erro ao enviar a mensagem. Tente novamente mais tarde.' });
    }
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`Servidor proxy rodando em http://localhost:${port}`);
});
