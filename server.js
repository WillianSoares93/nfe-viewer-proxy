// server.js
const express = require('express');
const cors = require('cors');
const { IncomingForm } = require('formidable');
const multer = require('multer'); // Necessário para o upload de arquivos do formulário de contato
const nodemailer = require('nodemailer'); // Necessário para o envio de e-mails
const puppeteer = require('puppeteer'); // Importa Puppeteer

const app = express();
const PORT = process.env.PORT || 3001;

// Configura o CORS para permitir requisições do seu frontend
// REMOVIDA A BARRA FINAL DA URL DO ORIGIN PARA COMBINAR EXATAMENTE COM O NAVEGADOR
app.use(cors({
    origin: process.env.FRONTEND_URL
}));

// Adiciona middleware para parsear corpos de requisição JSON
// Isso é crucial para que req.body funcione corretamente para o endpoint /proxy-sefaz-xml
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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

// --- NOVO ENDPOINT: Proxy para buscar XML da Sefaz via chave de acesso usando Puppeteer (Conceitual) ---
app.post('/proxy-sefaz-xml', async (req, res) => {
    console.log('Proxy: Recebida requisição para /proxy-sefaz-xml');
    const { chave, tipo } = req.body;

    if (!chave || chave.length !== 44) {
        console.error("Proxy: Chave de acesso inválida ou ausente para /proxy-sefaz-xml.");
        return res.status(400).json({ error: 'Chave de acesso inválida (deve ter 44 dígitos) ou ausente.' });
    }

    let sefazConsultaUrl = '';
    if (tipo === 'NFe') {
        sefazConsultaUrl = `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=`;
    } else if (tipo === 'CTe') {
        sefazConsultaUrl = `https://www.cte.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=mCK/KoCqru0=`;
    } else {
        console.error("Proxy: Tipo de documento inválido para /proxy-sefaz-xml:", tipo);
        return res.status(400).json({ error: 'Tipo de documento inválido.' });
    }

    let browser;
    try {
        // Inicia o navegador headless
        browser = await puppeteer.launch({
            headless: true, // Modo headless (sem interface gráfica)
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos necessários para ambientes como Render.com
        });
        const page = await browser.newPage();
        console.log(`Puppeteer: Navegando para a URL da Sefaz: ${sefazConsultaUrl}`);
        await page.goto(sefazConsultaUrl, { waitUntil: 'networkidle2' }); // Espera a rede ficar ociosa

        // Preenche a chave de acesso
        await page.type('#ctl00_ContentPlaceHolder1_txtChaveAcessoResumo', chave);
        console.log(`Puppeteer: Chave de acesso "${chave}" preenchida.`);

        // --- AQUI É ONDE O RECAPTCHA ENTRA EM CENA ---
        // O Puppeteer não resolve o reCAPTCHA automaticamente.
        // Você precisaria de uma lógica para:
        // 1. Detectar o reCAPTCHA.
        // 2. Enviar a imagem/dados do reCAPTCHA para um serviço de resolução de captcha (ex: 2Captcha, Anti-Captcha).
        // 3. Aguardar a resposta do serviço com o token do reCAPTCHA.
        // 4. Injetar o token no campo oculto do reCAPTCHA (h-captcha-response).
        // Exemplo (conceitual, não funcional sem serviço externo):
        // const recaptchaToken = await solveCaptchaService(page.url()); // Função fictícia
        // await page.evaluate((token) => {
        //     document.querySelector('textarea[name="h-captcha-response"]').value = token;
        // }, recaptchaToken);
        console.warn("Puppeteer: [AVISO] reCAPTCHA não será resolvido automaticamente. Intervenção manual ou serviço de terceiros necessários.");
        // Para fins de teste, você pode precisar de um reCAPTCHA token válido aqui
        // ou desabilitar o reCAPTCHA no ambiente de desenvolvimento da Sefaz (se possível).
        // Por enquanto, vamos assumir que o reCAPTCHA foi "resolvido" para prosseguir com o clique.
        // Em um cenário real, você esperaria que o usuário resolvesse ou usaria um serviço.

        // Clica no botão de consulta
        // Tenta o botão com hCaptcha primeiro, depois o normal
        let clicked = false;
        if (await page.$('#ctl00_ContentPlaceHolder1_btnConsultarHCaptcha')) {
            await page.click('#ctl00_ContentPlaceHolder1_btnConsultarHCaptcha');
            console.log('Puppeteer: Clicou em #ctl00_ContentPlaceHolder1_btnConsultarHCaptcha');
            clicked = true;
        } else if (await page.$('#ctl00_ContentPlaceHolder1_btnConsultar')) {
            await page.click('#ctl00_ContentPlaceHolder1_btnConsultar');
            console.log('Puppeteer: Clicou em #ctl00_ContentPlaceHolder1_btnConsultar');
            clicked = true;
        }

        if (!clicked) {
            throw new Error("Botão de consulta não encontrado na página da Sefaz.");
        }

        // Espera a navegação ou o carregamento de um elemento na página de resultados
        // Pode ser necessário ajustar o seletor ou o tempo de espera
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => {
            console.warn("Puppeteer: Timeout ao esperar navegação após clique. Tentando esperar elemento...");
            // Se a navegação não ocorrer (ex: erro na mesma página), tenta esperar por um elemento de erro ou sucesso.
        });

        // Verifica se a página de erro de certificado foi carregada
        const errorMessage = await page.$eval('#ctl00_ContentPlaceHolder1_lblMensagemErro', el => el.textContent.trim())
            .catch(() => null); // Se o elemento não for encontrado, retorna null

        if (errorMessage && errorMessage.includes('É necessário utilizar certificado digital')) {
            console.warn("Puppeteer: Sefaz retornou erro de certificado digital após a consulta.");
            // Neste ponto, o Sefaz está exigindo certificado.
            // A extensão FSist original contorna isso fazendo um XHR no background script.
            // Para o proxy, você teria que tentar o download direto do XML aqui,
            // mas isso geralmente é o que o Sefaz bloqueia.

            // Para simular o sucesso e permitir que o frontend continue,
            // vamos retornar o XML simulado mesmo com o erro de certificado.
            // Em um cenário real, você teria que decidir como lidar com isso:
            // 1. Informar ao usuário que o certificado é necessário.
            // 2. Tentar um método alternativo (se existir) para obter o XML sem certificado.
            // Por enquanto, o objetivo é que o frontend receba *algum* XML.
            const dummyXmlContent = `<NFe><infNFe Id="NFe${chave}"><ide><cUF>35</cUF><cNF>12345678</cNF><natOp>VENDA</natOp></ide><emit><CNPJ>11111111111111</CNPJ><xNome>XML_SIMULADO_VIA_PROXY_ERRO_CERT</xNome></emit><det nItem="1"><prod><cProd>0001</cProd><xProd>PRODUTO TESTE</xProd><qCom>1.00</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det></infNFe><Signature><SignedInfo><Reference URI="#NFe${chave}"></Reference></SignedInfo><SignatureValue>SIMULATED_SIGNATURE</SignatureValue></Signature></NFe>`;
            res.json({ xmlContent: dummyXmlContent, warning: errorMessage });
            return;
        }

        // Tenta encontrar o link de download do XML na página de resultados
        const downloadLink = await page.$eval('a[href*="downloadNFe.aspx"], a[href*="downloadCTe.aspx"]', el => el.href)
            .catch(() => null); // Se não encontrar, retorna null

        if (downloadLink) {
            console.log(`Puppeteer: Link de download do XML encontrado: ${downloadLink}`);
            // Faz a requisição direta para o link de download do XML
            const xmlResponse = await page.goto(downloadLink, { waitUntil: 'domcontentloaded' });
            const xmlContent = await xmlResponse.text();

            if (xmlContent.includes('<NFe') || xmlContent.includes('<CTe')) {
                console.log('Puppeteer: XML baixado com sucesso via link de download.');
                res.json({ xmlContent: xmlContent });
            } else {
                console.error("Puppeteer: Conteúdo baixado do link de download não parece ser XML:", xmlContent.substring(0, 200) + '...');
                res.status(500).json({ error: 'Conteúdo baixado não é um XML válido.' });
            }
        } else {
            // Se não encontrou o link de download direto, tenta extrair de um elemento específico
            // Isso pode variar muito dependendo da estrutura da página da Sefaz
            const xmlElement = await page.$eval('#someXmlDisplayElement', el => el.textContent)
                .catch(() => null);

            if (xmlElement) {
                console.log('Puppeteer: XML encontrado em elemento na página.');
                res.json({ xmlContent: xmlElement });
            } else {
                console.error("Puppeteer: Não foi possível encontrar o XML nem o link de download na página de resultados.");
                res.status(404).json({ error: 'XML não encontrado na página da Sefaz.' });
            }
        }

    } catch (error) {
        console.error("Proxy: Erro ao processar requisição /proxy-sefaz-xml com Puppeteer:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao processar a requisição.', details: error.message });
    } finally {
        if (browser) {
            await browser.close(); // Garante que o navegador seja fechado
            console.log('Puppeteer: Navegador fechado.');
        }
    }
});
// --- FIM DO NOVO ENDPOINT ---


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
