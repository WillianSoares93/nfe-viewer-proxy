// server.js
const express = require('express');
const cors = require('cors');
const { IncomingForm } = require('formidable');
const multer = require('multer'); // Necessário para o upload de arquivos do formulário de contato
const nodemailer = require('nodemailer'); // Necessário para o envio de e-mails

const app = express();
const PORT = process.env.PORT || 3001;

// Configura o CORS para permitir requisições do seu frontend
// REMOVIDA A BARRA FINAL DA URL DO ORIGIN PARA COMBINAR EXATAMENTE COM O NAVEGADOR
app.use(cors({
    origin: process.env.FRONTEND_URL
}));

// Configuração do Multer para lidar com uploads de arquivos para o formulário de contato
// Não salva em disco, apenas em memória (req.files)
const upload = multer(); 

// Rota para o proxy da API FSist para GERAÇÃO DE PDF/XML (usada pelo index.html)
app.post('/proxy-fsist-gerarpdf', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-fsist-gerarpdf');
    const { default: fetch } = await import('node-fetch');
    const { FormData, File } = await import('formdata-node');

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

        const xmlFile = files.arquivo;
        const fileToProcess = Array.isArray(xmlFile) ? xmlFile[0] : xmlFile;

        if (!fileToProcess || !fileToProcess.buffer) {
            console.error("Proxy: Arquivo XML não fornecido para /proxy-fsist-gerarpdf.");
            return res.status(400).json({ error: 'Arquivo XML ausente ou inválido.' });
        }

        console.log(`Proxy: Fluxo de upload de arquivo (index.html): ${fileToProcess.originalFilename}, tamanho: ${fileToProcess.size}`);
        
        const formData = new FormData();
        formData.append('arquivo', new File([fileToProcess.buffer], fileToProcess.originalFilename, { type: fileToProcess.mimetype }));

        const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
        const apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
        const fetchMethod = "POST";
        const fetchBody = formData;
        
        try {
            const responseFsist = await fetch(apiUrlFsist, {
                method: fetchMethod,
                body: fetchBody,
                headers: {
                    'Accept': 'application/json',
                }
            });

            console.log(`Proxy: Resposta da FSist Status: ${responseFsist.status}`);
            const responseTextFsist = await responseFsist.text();
            console.log(`Proxy: Resposta bruta COMPLETA da FSist: ${responseTextFsist}`);

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

            if (responseTextFsist.trim().startsWith('<!DOCTYPE html>')) {
                console.error("Proxy: Resposta da API FSist é HTML inesperado, não JSON.");
                return res.status(500).json({ error: "API FSist retornou HTML inesperado em vez de JSON.", details: responseTextFsist.substring(0, 500) + '...' });
            }

            // Handler para a resposta da FSist no fluxo de upload de arquivo
            const jsonMatchFsist = responseTextFsist.match(/{.*}/s);
            if (!jsonMatchFsist) {
                throw new Error("Resposta da API FSist não contém um JSON válido para upload de arquivo.");
            }
            const finalResult = JSON.parse(jsonMatchFsist[0]);
            
            console.log("Proxy: Resposta final para o frontend:", finalResult);
            res.json(finalResult);

        } catch (error) {
            console.error("Proxy: Erro interno no try-catch do proxy:", error);
            res.status(500).json({ error: 'Erro interno do servidor ao processar a requisição.', details: error.message });
        }
    });
});

// NOVO ENDPOINT para o fluxo de CONSULTA DE CHAVE DE ACESSO (usado pelo baixarxml.html)
app.post('/proxy-fsist-consultar-sefaz', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-fsist-consultar-sefaz');
    const { default: fetch } = await import('node-fetch');
    const { FormData } = await import('formdata-node'); // Não precisamos de 'File' aqui

    const form = new IncomingForm({
        multiples: false,
    });

    form.parse(req, async (err, fields) => {
        if (err) {
            console.error("Proxy: Erro ao parsear formulário para consulta SEFAZ:", err);
            return res.status(500).json({ error: 'Erro interno do servidor ao processar a requisição.' });
        }

        const chave = Array.isArray(fields.chave) ? fields.chave[0] : fields.chave;
        const token = Array.isArray(fields.token) ? fields.token[0] : fields.token;
        const tipoDocumento = Array.isArray(fields.tipoDocumento) ? fields.tipoDocumento[0] : fields.tipoDocumento;

        if (!chave || chave.length !== 44 || !token) {
            console.error("Proxy: Chave de acesso ou token reCAPTCHA inválidos ou ausentes para consulta SEFAZ.");
            return res.status(400).json({ error: 'Chave de acesso inválida (deve ter 44 dígitos) ou token reCAPTCHA ausente.' });
        }

        console.log(`Proxy: Fluxo de consulta SEFAZ: Chave: ${chave}, Tipo: ${tipoDocumento}, Token reCAPTCHA: ${token.substring(0, 10)}...`);

        const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
        // Construindo a URL para a API da FSist para o tipo de consulta
        let apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=consulta&v=2&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
        apiUrlFsist += `&chave=${encodeURIComponent(chave)}`;
        apiUrlFsist += `&captcha=${encodeURIComponent(token)}`;
        apiUrlFsist += `&cte=${tipoDocumento === 'CTe' ? '1' : '0'}`;

        console.log("Proxy: URL completa para FSist (consulta SEFAZ):", apiUrlFsist);

        try {
            const responseFsist = await fetch(apiUrlFsist, {
                method: "GET", // A página original usa GET para esta consulta
                headers: {
                    'Accept': 'text/plain', // Esperamos uma resposta simples como "OK" ou erro
                }
            });

            console.log(`Proxy: Resposta da FSist Status (consulta SEFAZ): ${responseFsist.status}`);
            const responseTextFsist = await responseFsist.text();
            console.log(`Proxy: Resposta bruta COMPLETA da FSist (consulta SEFAZ): ${responseTextFsist}`);

            if (!responseFsist.ok) {
                console.error(`Proxy: Erro da API FSist (consulta SEFAZ): ${responseFsist.status} - ${responseTextFsist}`);
                return res.status(responseFsist.status).json({
                    status: 'ERROR',
                    message: `Erro da API FSist: ${responseFsist.status} ${responseFsist.statusText}`,
                    details: responseTextFsist
                });
            }

            const trimmedResponse = responseTextFsist.trim();

            if (trimmedResponse === "OK") {
                console.log("Proxy: Consulta SEFAZ bem-sucedida.");
                res.json({ status: 'OK' });
            } else {
                console.error("Proxy: Resposta de erro da FSist para consulta SEFAZ:", trimmedResponse);
                res.status(400).json({ status: 'ERROR', message: trimmedResponse || 'Erro desconhecido na consulta da FSist.' });
            }

        } catch (error) {
            console.error("Proxy: Erro interno no try-catch do proxy (consulta SEFAZ):", error);
            res.status(500).json({ status: 'ERROR', message: 'Erro interno do servidor ao processar a requisição de consulta SEFAZ.', details: error.message });
        }
    });
});

// Rota para o proxy de download do ZIP da API FSist
app.get('/proxy-fsist-downloadzip', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-fsist-downloadzip');
    const { default: fetch } = await import('node-fetch');

    const { id, arq } = req.query;

    if (!id || !arq) {
        console.error("Proxy: Parâmetros ausentes para download do ZIP.");
        return res.status(400).json({ error: 'Parâmetros "id" ou "arq" ausentes para o download do ZIP.' });
    }

    try {
        const zipDownloadUrl = `https://www.fsist.com.br/comandos.aspx?t=gerarpdfdownload&id=${id}&arq=${encodeURIComponent(arq)}`;
        console.log(`Proxy: Baixando ZIP da FSist: ${zipDownloadUrl}`);

        const zipResponse = await fetch(zipDownloadUrl);
        console.log(`Proxy: Resposta download ZIP FSist Status: ${zipResponse.status}`);

        if (!zipResponse.ok) {
            const errorText = await zipResponse.text();
            console.error(`Proxy: Erro ao baixar ZIP da API FSist: ${zipResponse.status} - ${errorText}`);
            if (errorText.trim().startsWith('<!DOCTYPE html>')) {
                return res.status(502).json({
                    error: `API FSist retornou uma página HTML de erro ao tentar baixar o ZIP (Status: ${zipResponse.status}).`,
                    details: errorText.substring(0, 500) + '...'
                });
            }
            return res.status(zipResponse.status).json({
                error: `Erro ao baixar o arquivo ZIP: ${zipResponse.status} ${zipResponse.statusText}`,
                details: errorText
            });
        }

        res.setHeader('Content-Type', zipResponse.headers.get('Content-Type') || 'application/zip');
        res.setHeader('Content-Disposition', zipResponse.headers.get('Content-Disposition') || `attachment; filename="${arq}"`);

        zipResponse.body.pipe(res);
        console.log('Proxy: ZIP enviado com sucesso para o frontend.');

    } catch (error) {
        console.error("Proxy: Erro interno no try-catch do proxy ao baixar ZIP:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao baixar o arquivo ZIP.', details: error.message });
    }
});

// NOVO ENDPOINT PARA ENVIO DE E-MAIL DA PÁGINA DE CONTATO
app.post('/send-contact-email', upload.array('arquivo'), async (req, res) => { // 'arquivo' é o nome do campo de input type="file"
    console.log('Proxy: Recebida requisição para /send-contact-email');
    try {
        const { email, motivo, descricao } = req.body; // Campos esperados do formulário de contato

        // Validação básica dos campos
        if (!email || !motivo || !descricao) {
            console.error('Proxy: Campos obrigatórios ausentes no formulário de contato.');
            return res.status(400).json({ status: 'ERROR', message: 'Campos obrigatórios ausentes: e-mail, motivo, descrição.' });
        }
        if (email.indexOf("@") === -1 || email.indexOf(".") === -1) { // Validação de formato de e-mail mais robusta
            console.error('Proxy: Formato de e-mail inválido:', email);
            return res.status(400).json({ status: 'ERROR', message: 'Formato de e-mail inválido.' });
        }
        if (motivo === 'Motivo do Contato') {
            console.error('Proxy: Motivo de contato não selecionado.');
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
            console.log(`Proxy: Anexados ${req.files.length} arquivos.`);
        }

        // Configuração do Nodemailer (substitua com suas credenciais e serviço)
        // É CRUCIAL USAR VARIÁVEIS DE AMBIENTE PARA AS CREDENCIAIS EM PRODUÇÃO!
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Exemplo: 'gmail', 'SendGrid', etc.
            auth: {
                user: 'cwsm1993@gmail.com', // Seu e-mail que enviará a mensagem
                pass: process.env.EMAIL_PASSWORD // Use variável de ambiente para a senha!
            }
        });

        // Opções do e-mail
        const mailOptions = {
            from: 'cwsm1993@gmail.com', // Remetente
            to: 'cwsm1993@gmail.com', // E-mail de destino (o seu)
            subject: `Contato NF-e Viewer: ${motivo}`, // Assunto do e-mail
            html: `
                <p><strong>De:</strong> ${email}</p>
                <p><strong>Motivo do Contato:</strong> ${motivo}</p>
                <hr>
                <p><strong>Descrição:</strong></p>
                <p>${descricao}</p>
            `,
            attachments: attachments
        };

        // Envia o e-mail
        await transporter.sendMail(mailOptions);
        console.log('Proxy: E-mail de contato enviado com sucesso.');
        res.json({ status: 'OK', message: 'Mensagem enviada com sucesso!' });

    } catch (error) {
        console.error('Proxy: Erro ao enviar e-mail de contato:', error);
        // Garante que a resposta seja JSON mesmo em caso de erro
        res.status(500).json({ status: 'ERROR', message: 'Erro ao enviar a mensagem. Tente novamente mais tarde.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor proxy rodando em http://localhost:${PORT}`);
    console.log(`Certifique-se de que seu frontend esteja em http://localhost:3000 (ou a porta configurada no CORS)`);
});
