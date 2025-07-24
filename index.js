import express from 'express';
import { formatInTimeZone } from 'date-fns-tz';

const app = express();
const PORT = process.env.PORT || 3000;

const vehicleCache = {};

// Funções de cálculo de distância e direção
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const λ1 = lon1 * Math.PI / 180;
    const λ2 = lon2 * Math.PI / 180;
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
}


async function fetchAndProcessVehicles() {
    console.log(`[${new Date().toISOString()}] Iniciando busca de veículos...`);
    const brtApiUrl = 'https://dados.mobilidade.rio/gps/brt';
    const sppoApiUrlBase = 'https://dados.mobilidade.rio/gps/sppo';

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const rioTimeZone = 'America/Sao_Paulo';

    const dataInicialFormatted = formatInTimeZone(tenMinutesAgo, rioTimeZone, 'yyyy-MM-dd+HH:mm:ss');
    const dataFinalFormatted = formatInTimeZone(now, rioTimeZone, 'yyyy-MM-dd+HH:mm:ss');

    const sppoUri = `${sppoApiUrlBase}?dataInicial=${dataInicialFormatted}&dataFinal=${dataFinalFormatted}`;

    try {
        const [brtResponse, sppoResponse] = await Promise.all([fetch(brtApiUrl), fetch(sppoUri)]);

        let brtVehicles = brtResponse.ok ? (await brtResponse.json()).veiculos || [] : [];
        let sppoVehicles = sppoResponse.ok ? await sppoResponse.json() : [];

        if (!brtResponse.ok) console.error(`ERRO API BRT: Status ${brtResponse.status}`);
        if (!sppoResponse.ok) console.error(`ERRO API SPPO: Status ${sppoResponse.status}. URL: ${sppoUri}`);

        const allVehiclesRaw = [...brtVehicles, ...sppoVehicles];

        for (const v of allVehiclesRaw) {
            const vehicleId = v.ordem || v.codigo;
            const dataHoraRaw = v.datahora || v.dataHora;

            if (!vehicleId || !dataHoraRaw) continue;

            const latitude = parseFloat(String(v.latitude).replace(',', '.'));
            const longitude = parseFloat(String(v.longitude).replace(',', '.'));
            const velocidade = parseInt(v.velocidade, 10);
            const dataHora = parseInt(dataHoraRaw, 10);

            if (isNaN(latitude) || isNaN(longitude) || isNaN(velocidade) || isNaN(dataHora)) {
                continue;
            }
            if (latitude === 0 || longitude === 0) continue;

            const oldVehicleData = vehicleCache[vehicleId];
            let direction = oldVehicleData ? oldVehicleData.direcao : null;
            if (oldVehicleData && (oldVehicleData.latitude !== latitude || oldVehicleData.longitude !== longitude)) {
                if (calculateDistance(oldVehicleData.latitude, oldVehicleData.longitude, latitude, longitude) > 10) {
                    direction = calculateBearing(oldVehicleData.latitude, oldVehicleData.longitude, latitude, longitude);
                }
            }

            vehicleCache[vehicleId] = {
                codigo: vehicleId,
                linha: v.linha,
                dataHora: dataHora,
                latitude: latitude,
                longitude: longitude,
                velocidade: velocidade,
                direcao: direction,
                sentido: v.sentido || null,
                trajeto: v.trajeto || null
            };
        }
        console.log(`Cache atualizado. Total de veículos: ${Object.keys(vehicleCache).length}`);

    } catch (error) {
        console.error("ERRO AO ATUALIZAR CACHE:", error);
    }
}


// --- Configuração do Servidor Express ---
app.get('/api/vehicles', (req, res) => res.json(Object.values(vehicleCache)));
app.get('/', (req, res) => res.send(`Servidor do Cadê o Ônibus? no ar. Veículos em cache: ${Object.keys(vehicleCache).length}`));

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    fetchAndProcessVehicles();
    setInterval(fetchAndProcessVehicles, 10000);
});