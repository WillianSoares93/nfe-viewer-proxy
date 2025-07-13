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

// Rota para o proxy da API FSist
app.post('/proxy-fsist-gerarpdf', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-fsist-gerarpdf');
    const { default: fetch } = await import('node-fetch');
    const { FormData, File } = await import('formdata-node');

    // Use formidable para parsear o formulário, pois ele pode conter campos de texto e arquivos
    const form = new IncomingForm({
        multiples: false, // Define se múltiplos arquivos podem ser enviados para o mesmo campo
        // fileWriteStreamHandler: (file) => { // Removido, pois multer já lida com buffers
        //     const buffers = [];
        //     const writable = new (require('stream').Writable)();
        //     writable._write = (chunk, encoding, callback) => {
        //         buffers.push(chunk);
        //         callback();
        //     };
        //     file.on('end', () => {
        //         file.buffer = Buffer.concat(buffers);
        //     });
        //     return writable;
        // }
    });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error("Proxy: Erro ao parsear formulário:", err);
            return res.status(500).json({ error: 'Erro interno do servidor ao processar o upload.' });
        }

        // Extrai os campos de texto do formulário
        const chave = Array.isArray(fields.chave) ? fields.chave[0] : fields.chave;
        const token = Array.isArray(fields.token) ? fields.token[0] : fields.token;
        const tipoDocumento = Array.isArray(fields.tipoDocumento) ? fields.tipoDocumento[0] : fields.tipoDocumento;

        if (!chave || chave.length !== 44) {
            console.error("Proxy: Chave de acesso inválida ou ausente.");
            return res.status(400).json({ error: 'Chave de acesso inválida ou ausente.' });
        }
        if (!token) {
            console.error("Proxy: Token reCAPTCHA ausente.");
            return res.status(400).json({ error: 'Token reCAPTCHA ausente.' });
        }

        console.log(`Proxy: Chave recebida: ${chave}, Tipo: ${tipoDocumento}, Token reCAPTCHA: ${token.substring(0, 10)}...`);

        try {
            // A API da FSist espera a chave e o token como parâmetros de URL para a consulta
            const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
            let apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
            
            apiUrlFsist += `&chave=${encodeURIComponent(chave)}`;
            apiUrlFsist += `&captcha=${encodeURIComponent(token)}`; // O token reCAPTCHA é o "captcha" para a FSist
            apiUrlFsist += `&cte=${tipoDocumento === 'CTe' ? '1' : '0'}`; // Adiciona o tipo de documento

            console.log(`Proxy: Enviando para FSist: ${apiUrlFsist}`);
            const responseFsist = await fetch(apiUrlFsist, {
                method: "GET", // A API da FSist parece usar GET para a consulta inicial
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

            if (responseTextFsist.trim().startsWith('<!DOCTYPE html>')) {
                console.error("Proxy: Resposta da API FSist é HTML inesperado, não JSON.");
                return res.status(500).json({ error: "API FSist retornou HTML inesperado em vez de JSON.", details: responseTextFsist.substring(0, 500) + '...' });
            }

            const jsonMatchFsist = responseTextFsist.match(/{.*}/s);

            if (!jsonMatchFsist) {
                console.error("Proxy: Resposta da API FSist não contém um JSON válido ou está vazia após tentativa de extração.");
                return res.status(500).json({ error: "Resposta da API FSist não contém um JSON válido." });
            }

            const resultDataFsist = JSON.parse(jsonMatchFsist[0]);
            console.log("Proxy: Resposta da API FSist (JSON parseado):", resultDataFsist);

            // Adapte a resposta para o frontend, incluindo linkPDF e linkXML
            // A FSist pode retornar um link direto ou um ID para download.
            // Se retornar um ID, você precisará usar o endpoint `/proxy-fsist-downloadzip` para obter o arquivo.
            
            if (resultDataFsist.linkPDF || resultDataFsist.linkXML) {
                res.json({
                    status: 'OK',
                    linkPDF: resultDataFsist.linkPDF,
                    linkXML: resultDataFsist.linkXML
                });
            } else if (resultDataFsist.id && resultDataFsist.arq) {
                 // Se o FSist retornar um ID e nome de arquivo, construa os links de download
                const downloadPdfLink = `${PROXY_BASE_URL}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.arq)}.pdf`;
                const downloadXmlLink = `${PROXY_BASE_URL}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.arq)}.xml`;

                res.json({
                    status: 'OK',
                    linkPDF: downloadPdfLink,
                    linkXML: downloadXmlLink
                });
            } else {
                res.status(500).json({ status: 'ERROR', message: 'Resposta inesperada da API FSist.', details: resultDataFsist });
            }

        } catch (error) {
            console.error("Proxy: Erro interno no try-catch do proxy ao gerar PDF:", error);
            res.status(500).json({ error: 'Erro interno do servidor ao gerar DANFE.', details: error.message });
        } finally {
            // Não há arquivos temporários para remover, pois tudo é processado em memória
        }
    });
}); // <-- Fechamento da rota app.post('/proxy-fsist-gerarpdf')

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
}); // <-- Fechamento da rota app.get('/proxy-fsist-downloadzip')

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
