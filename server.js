    // server.js
    const express = require('express');
    const cors = require('cors');
    const { IncomingForm } = require('formidable'); // Importa IncomingForm diretamente
    // const fs = require('fs'); // Não é mais necessário, pois não salvaremos arquivos em disco

    const app = express();
    const PORT = process.env.PORT || 3001; // Render injeta a porta em process.env.PORT

    // Configura o CORS para permitir requisições do seu frontend (localhost:3000 ou a porta que você usa)
    // ESTA URL SERÁ ATUALIZADA APÓS O DEPLOY DO FRONTEND NO VERCEL
    app.use(cors({
        origin: 'http://localhost:3000' // Altere para a porta que seu frontend está usando (ex: 8000, 8080)
    }));

    // Rota para o proxy da API FSist
    app.post('/proxy-fsist-gerarpdf', async (req, res) => {
        console.log('Proxy: Recebida requisição para /proxy-fsist-gerarpdf');
        // Importa node-fetch e FormData dinamicamente para evitar ERR_REQUIRE_ESM
        const { default: fetch } = await import('node-fetch');
        const { FormData, File } = await import('formdata-node'); // Importa FormData e File para ambiente Node.js

        const form = new IncomingForm({
            multiples: false,
            // Configura para lidar com o arquivo em memória (buffer)
            fileWriteStreamHandler: (file) => {
                const buffers = [];
                const writable = new (require('stream').Writable)();
                writable._write = (chunk, encoding, callback) => {
                    buffers.push(chunk);
                    callback();
                };
                file.on('end', () => {
                    file.buffer = Buffer.concat(buffers); // Armazena o buffer no objeto 'file'
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

            // Agora, verificamos se o buffer do arquivo existe
            if (!fileToProcess || !fileToProcess.buffer) {
                console.error("Proxy: Nenhum arquivo XML foi enviado ou o buffer do arquivo não foi encontrado.");
                return res.status(400).json({ error: 'Nenhum arquivo XML foi enviado ou ocorreu um problema no upload (buffer não encontrado).' });
            }

            console.log(`Proxy: Arquivo XML recebido: ${fileToProcess.originalFilename}, tamanho: ${fileToProcess.size}`);

            try {
                const formData = new FormData();
                // Adiciona o arquivo XML ao FormData para enviar para a API FSist
                // Usamos o buffer do arquivo diretamente
                formData.append('arquivo', new File([fileToProcess.buffer], fileToProcess.originalFilename, { type: fileToProcess.mimetype }));

                const randomNumber = Math.floor(Math.random() * (9999 - 0 + 1)) + 0;
                const apiUrlFsist = `https://www.fsist.com.br/comandos.aspx?t=gerarpdf&arquivos=1&nomedoarquivo=&r=${randomNumber}`;

                console.log(`Proxy: Enviando XML para FSist: ${apiUrlFsist}`);
                const responseFsist = await fetch(apiUrlFsist, {
                    method: "POST",
                    body: formData,
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

                res.json(resultDataFsist);

            } catch (error) {
                console.error("Proxy: Erro interno no try-catch do proxy ao gerar PDF:", error);
                res.status(500).json({ error: 'Erro interno do servidor ao gerar DANFE.', details: error.message });
            } finally {
                // Não há arquivos temporários para remover, pois tudo é processado em memória
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

    app.listen(PORT, () => {
        console.log(`Servidor proxy rodando em http://localhost:${PORT}`);
        console.log(`Certifique-se de que seu frontend esteja em http://localhost:3000 (ou a porta configurada no CORS)`);
    });
    