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

    const form = new IncomingForm({
        multiples: false,
        // RE-ADICIONANDO fileWriteStreamHandler para garantir que file.buffer seja populado
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

        // Extrai campos que podem vir de ambos os formulários ou de apenas um
        const chave = Array.isArray(fields.chave) ? fields.chave[0] : fields.chave;
        const token = Array.isArray(fields.token) ? fields.token[0] : fields.token;
        const tipoDocumento = Array.isArray(fields.tipoDocumento) ? fields.tipoDocumento[0] : fields.tipoDocumento;

        const xmlFile = files.arquivo; // `files.arquivo` é o campo de upload do index.html
        const fileToProcess = Array.isArray(xmlFile) ? xmlFile[0] : xmlFile;

        let apiUrlFsist;
        let fetchMethod;
        let fetchBody = null;
        let responseHandler;

        // --- Lógica para o fluxo de upload de arquivo (do index.html) ---
        // Prioriza a detecção de um arquivo XML enviado
        if (fileToProcess && fileToProcess.buffer) {
            console.log(`Proxy: Fluxo de upload de arquivo (index.html): ${fileToProcess.originalFilename}, tamanho: ${fileToProcess.size}`);
            
            const formData = new FormData();
            formData.append('arquivo', new File([fileToProcess.buffer], fileToProcess.originalFilename, { type: fileToProcess.mimetype }));

            const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
            apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
            fetchMethod = "POST";
            fetchBody = formData;
            
            // Handler para a resposta da FSist no fluxo de upload de arquivo
            responseHandler = (responseTextFsist) => {
                const jsonMatchFsist = responseTextFsist.match(/{.*}/s);
                if (!jsonMatchFsist) {
                    throw new Error("Resposta da API FSist não contém um JSON válido para upload de arquivo.");
                }
                return JSON.parse(jsonMatchFsist[0]);
            };

        } 
        // --- Lógica para o fluxo de consulta por chave (do baixarxml.html) ---
        // Se não houver arquivo, verifica se há chave e token
        else if (chave && chave.length === 44 && token) {
            console.log(`Proxy: Fluxo de consulta por chave (baixarxml.html): ${chave}, Tipo: ${tipoDocumento}, Token reCAPTCHA: ${token.substring(0, 10)}...`);

            const fsistFormData = new FormData();
            fsistFormData.append('chave', chave);
            fsistFormData.append('captcha', token); // FSist espera 'captcha' para o token reCAPTCHA
            fsistFormData.append('cte', tipoDocumento === 'CTe' ? '1' : '0'); // FSist espera 'cte' como '1' ou '0'

            const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
            apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;
            fetchMethod = "POST"; // MUDANÇA CRUCIAL: Enviar como POST para FSist
            fetchBody = fsistFormData; // Enviar o FormData com os parâmetros
            
            // Handler para a resposta da FSist no fluxo de consulta por chave
            responseHandler = (responseTextFsist) => {
                // Adicionado log da resposta completa para depuração
                console.log("Proxy: Resposta COMPLETA da FSist para consulta por chave:", responseTextFsist);

                let resultDataFsist;
                try {
                    // Tenta parsear diretamente se for JSON puro
                    resultDataFsist = JSON.parse(responseTextFsist);
                } catch (parseError) {
                    // Se falhar, tenta extrair JSON com regex (caso esteja embutido)
                    const jsonMatchFsist = responseTextFsist.match(/{.*}/s);
                    if (!jsonMatchFsist) {
                        throw new Error("Resposta da API FSist não contém um JSON válido para consulta por chave.");
                    }
                    resultDataFsist = JSON.parse(jsonMatchFsist[0]);
                }

                // Adapta a resposta para o frontend, incluindo linkPDF e linkXML
                if (resultDataFsist.linkPDF || resultDataFsist.linkXML) {
                    return {
                        status: 'OK',
                        linkPDF: resultDataFsist.linkPDF,
                        linkXML: resultDataFsist.linkXML
                    };
                } else if (resultDataFsist.id && resultDataFsist.arq) {
                     // Se o FSist retornar um ID e nome de arquivo, construa os links de download
                    // Usar o FRONTEND_URL para construir o link completo para o proxy
                    const downloadPdfLink = `${process.env.FRONTEND_URL}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.arq)}.pdf`;
                    const downloadXmlLink = `${process.env.FRONTEND_URL}/proxy-fsist-downloadzip?id=${resultDataFsist.id}&arq=${encodeURIComponent(resultDataFsist.arq)}.xml`;
                    return {
                        status: 'OK',
                        linkPDF: downloadPdfLink,
                        linkXML: downloadXmlLink
                    };
                } else {
                    throw new Error('Resposta inesperada da API FSist para consulta por chave.');
                }
            };
        } 
        // --- Caso de erro: nenhuma das lógicas foi identificada ---
        else {
            console.error("Proxy: Requisição inválida. Nem arquivo XML nem chave de acesso/token reCAPTCHA foram fornecidos corretamente.");
            return res.status(400).json({ error: 'Requisição inválida. Por favor, forneça um arquivo XML ou uma chave de acesso e token reCAPTCHA válidos.' });
        }

        // --- Lógica comum de fetch para a API FSist ---
        try {
            const responseFsist = await fetch(apiUrlFsist, {
                method: fetchMethod,
                body: fetchBody,
            });

            console.log(`Proxy: Resposta da FSist Status: ${responseFsist.status}`);
            const responseTextFsist = await responseFsist.text();
            // Alterado para logar a resposta completa para depuração
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

            const finalResult = responseHandler(responseTextFsist);
            console.log("Proxy: Resposta final para o frontend:", finalResult);
            res.json(finalResult);

        } catch (error) {
            console.error("Proxy: Erro interno no try-catch do proxy:", error);
            res.status(500).json({ error: 'Erro interno do servidor ao processar a requisição.', details: error.message });
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
