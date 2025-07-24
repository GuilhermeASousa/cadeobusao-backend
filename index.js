import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Lógica de Cache e Busca (idêntica à anterior) ---

const vehicleCache = {};

function getFormattedDate(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Raio da Terra em metros
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
    console.log(`[${new Date().toISOString()}] Iniciando busca e processamento de veículos...`);
    const brtApiUrl = 'https://dados.mobilidade.rio/gps/brt';
    const sppoApiUrlBase = 'https://dados.mobilidade.rio/gps/sppo';

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const sppoUri = `${sppoApiUrlBase}?dataInicial=${getFormattedDate(tenMinutesAgo)}&dataFinal=${getFormattedDate(now)}`;

    try {
        const [brtResponse, sppoResponse] = await Promise.all([fetch(brtApiUrl), fetch(sppoUri)]);
        const brtData = brtResponse.ok ? await brtResponse.json() : { veiculos: [] };
        const sppoData = sppoResponse.ok ? await sppoResponse.json() : [];
        const allVehiclesRaw = [...(brtData.veiculos || []), ...sppoData];

        for (const v of allVehiclesRaw) {
            const vehicleId = v.ordem || v.codigo;
            if (!vehicleId) continue;

            const newPosition = { lat: parseFloat(String(v.latitude).replace(',', '.')), lon: parseFloat(String(v.longitude).replace(',', '.')) };
            if (newPosition.lat === 0 || newPosition.lon === 0) continue;

            const oldVehicleData = vehicleCache[vehicleId];
            let direction = oldVehicleData ? oldVehicleData.direcao : null;
            if (oldVehicleData && (oldVehicleData.latitude !== newPosition.lat || oldVehicleData.longitude !== newPosition.lon)) {
                if (calculateDistance(oldVehicleData.latitude, oldVehicleData.longitude, newPosition.lat, newPosition.lon) > 10) {
                    direction = calculateBearing(oldVehicleData.latitude, oldVehicleData.longitude, newPosition.lat, newPosition.lon);
                }
            }
            vehicleCache[vehicleId] = { codigo: vehicleId, linha: v.linha, dataHora: parseInt(v.datahora, 10), latitude: newPosition.lat, longitude: newPosition.lon, velocidade: parseInt(v.velocidade, 10), direcao: direction, sentido: v.sentido || null, trajeto: v.trajeto || null };
        }
        console.log(`Cache atualizado. Total de veículos: ${Object.keys(vehicleCache).length}`);

    } catch (error) {
        console.error("ERRO AO ATUALIZAR CACHE:", error);
    }
}


// --- Configuração do Servidor Express ---

// Endpoint que o seu aplicativo Flutter irá chamar
app.get('/api/vehicles', (req, res) => {
    // Retorna a lista de veículos que está no cache
    res.json(Object.values(vehicleCache));
});

// Endpoint de "saúde" para verificar se o servidor está no ar
app.get('/', (req, res) => {
    res.send(`Servidor do Cadê o Ônibus? no ar. Veículos em cache: ${Object.keys(vehicleCache).length}`);
});


// Inicia o servidor e a lógica de atualização
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);

    // 1. Faz uma busca inicial imediatamente ao iniciar o servidor
    fetchAndProcessVehicles();

    // 2. Configura o intervalo para rodar a cada 20 segundos
    setInterval(fetchAndProcessVehicles, 20000); // 20000 milissegundos = 20 segundos
});