// server.js

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Para requisições HTTP no backend
const multer = require('multer'); // Para lidar com upload de arquivos (printscreen)
const nodemailer = require('nodemailer'); // Para enviar e-mails

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

// --- Endpoint para proxy da API FSist (manter o que você já tem) ---
app.post('/proxy-fsist-gerarpdf', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const formData = new FormData();
        // Anexa o arquivo XML recebido do frontend
        formData.append('arquivo', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
        // Adicione outros campos que a API FSist possa esperar
        // formData.append('parametro1', 'valor1');

        const fsistResponse = await fetch(`${FSIST_API_BASE_URL}/api/gerarPdf`, { // Ajuste o endpoint da FSist
            method: 'POST',
            body: formData,
            // Headers podem ser necessários, dependendo da API FSist (ex: Authorization)
            // headers: { 'Authorization': 'Bearer SEU_TOKEN_FSIST' }
        });

        if (!fsistResponse.ok) {
            const errorText = await fsistResponse.text();
            console.error('Erro na resposta da FSist:', fsistResponse.status, errorText);
            return res.status(fsistResponse.status).json({ error: `Erro da API FSist: ${errorText}` });
        }

        const fsistData = await fsistResponse.json();
        res.json(fsistData); // Retorna a resposta da FSist para o frontend

    } catch (error) {
        console.error('Erro no proxy FSist:', error);
        res.status(500).json({ error: 'Erro interno no servidor ao chamar a API FSist.' });
    }
});

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


// --- NOVO ENDPOINT PARA ENVIO DE E-MAIL ---
app.post('/send-contact-email', upload.array('arquivo'), async (req, res) => { // 'arquivo' é o nome do campo de input type="file"
    try {
        const { email, pagina, motivo, descricao } = req.body; // Removidos formadeuso e funcionalidade

        // Validação básica dos campos
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

        // Verifica se há arquivos anexados (printscreen)
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                attachments.push({
                    filename: file.originalname,
                    content: file.buffer, // Conteúdo do arquivo em buffer
                    contentType: file.mimetype
                });
            });
        }

        // Configuração do Nodemailer (substitua com suas credenciais e serviço)
        // Exemplo para Gmail (requer "senha de app" se 2FA estiver ativado)
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Ou 'smtp.seudominio.com' para outros
            auth: {
                user: 'SEU_EMAIL@gmail.com', // Seu e-mail que enviará a mensagem
                pass: 'SUA_SENHA_DE_APP_OU_SENHA_NORMAL' // Senha de app ou senha do e-mail
            }
        });

        // Opções do e-mail
        const mailOptions = {
            from: 'SEU_EMAIL@gmail.com', // Remetente
            to: 'cwsm1993@gmail.com', // E-mail de destino (o seu)
            subject: `Contato NF-e Viewer: ${motivo}`, // Assunto ajustado
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

        // Envia o e-mail
        await transporter.sendMail(mailOptions);

        res.json({ status: 'OK', message: 'Mensagem enviada com sucesso!' });

    } catch (error) {
        console.error('Erro ao enviar e-mail de contato:', error);
        // Garante que a resposta seja JSON mesmo em caso de erro
        res.status(500).json({ status: 'ERROR', message: 'Erro ao enviar a mensagem. Tente novamente mais tarde.' });
    }
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`Servidor proxy rodando em http://localhost:${port}`);
});
