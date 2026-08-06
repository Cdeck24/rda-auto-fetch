const { randomUUID } = require('crypto');
const Hashids = require('hashids/cjs');

// ==========================================================
// CONFIGURATION
// ==========================================================
// PASTE YOUR GOOGLE APPS SCRIPT URL HERE
const APPS_SCRIPT_URL_SCORES = 'https://script.google.com/macros/s/AKfycbyY4rz_46uk2JnqO4y7Os-0LHSU4TL43jPrtG-GXYUC61XU2o1QXoK0qMpdTdwzmenG/exec';

const REAL_AUTH_TOKEN = 'xnr5VpW3!ApZk8L2E!4fe6e26f-949f-4936-ae3e-16384878932f';
const REAL_VERSION = '27';
const SEASON = '6';

const CSV_PLAYERS = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7pZmpj4lJiBMkcjcgzJ77n2xmFIRlmuD-0Zuakz8lZekYobXkmTjfaEwhJYdNuM5F9VKlDm-FPaw8/pub?gid=0&single=true&output=csv';
const CSV_SCHEDULE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS93Cbk4JUmCBgtIR1-RnSHlYY9E-dxEEWVT_Jx-T_Lm07oa6KYlnBGAqaGJin4VBpG4GmOGn8ktTPy/pub?gid=1595040071&single=true&output=csv';

// ==========================================================
// UTILITIES
// ==========================================================
function generateRequestToken() {
    const timestampMs = Date.now();
    const hasher = new Hashids("realwebapp", 16);
    return hasher.encode(timestampMs);
}

// Determines "Yesterday's" Date in EST (Since this runs at 4 AM)
function getTargetDate() {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "America/New_York"}));
    d.setDate(d.getDate() - 1); 
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Bulletproof Date Matcher (Handles "7/28" vs "7/28/2026")
const isSameDate = (csvDate, todayStr) => {
    if (!csvDate) return false;
    const cleanDate = String(csvDate).trim();
    if (cleanDate === todayStr) return true;
    
    const parsed = new Date(cleanDate);
    if (!isNaN(parsed.getTime())) {
        if (`${parsed.getMonth() + 1}/${parsed.getDate()}` === todayStr) return true;
    }
    
    const partsSlash = cleanDate.split('/');
    if (partsSlash.length >= 2 && `${parseInt(partsSlash[0])}/${parseInt(partsSlash[1])}` === todayStr) return true;
    
    return false;
};

async function fetchCSV(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch CSV');
    const text = await res.text();
    return text.trim().split('\n').map(r => {
        let inQuotes = false;
        let currentVal = '';
        const values = [];
        for (let i = 0; i < r.length; i++) {
            const char = r[i];
            if (char === '"' && (i === 0 || r[i-1] !== '\\')) inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) { values.push(currentVal.trim()); currentVal = ''; }
            else currentVal += char;
        }
        values.push(currentVal.trim());
        return values;
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRealDraftStats(url, retries = 0) {
    const token = generateRequestToken();
    
    const res = await fetch(url, {
        headers: {
            'real-auth-info': REAL_AUTH_TOKEN,
            'real-device-name': 'Chrome on Web',
            'real-device-type': 'desktop_web',
            'real-device-uuid': randomUUID(),
            'real-request-token': token,
            'real-version': REAL_VERSION,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Origin': 'https://realsports.io',
            'Accept': 'application/json'
        }
    });

    if (res.status === 429 && retries < 3) {
        await sleep(3000);
        return fetchRealDraftStats(url, retries + 1);
    }
    
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

// ==========================================================
// MAIN WORKER
// ==========================================================
async function run() {
    const targetDate = getTargetDate();
    console.log(`Starting automated fetch for date: ${targetDate}`);

    try {
        // 1. Fetch CSVs
        const [playersCsv, scheduleCsv] = await Promise.all([fetchCSV(CSV_PLAYERS), fetchCSV(CSV_SCHEDULE)]);
        
        const schedHeaders = scheduleCsv[0].map(h => h.toLowerCase());
        const dIdx = schedHeaders.findIndex(h => h.includes('date'));
        const t1Idx = schedHeaders.findIndex(h => h.includes('team1') || h.includes('team 1'));
        const t2Idx = schedHeaders.findIndex(h => h.includes('team2') || h.includes('team 2'));
        const typeIdx = schedHeaders.findIndex(h => h.includes('game type'));

        const todayGames = [];
        let isPlayoff = false;
        let isPreseason = false;

        scheduleCsv.slice(1).forEach(r => {
            if (isSameDate(r[dIdx], targetDate)) {
                todayGames.push({ team1: r[t1Idx]?.trim(), team2: r[t2Idx]?.trim() });
                const typeStr = typeIdx > -1 ? (r[typeIdx] || '').toLowerCase() : '';
                
                if (typeStr.includes('playoff')) {
                    isPlayoff = true;
                }
                if (typeStr.includes('preseason') || typeStr.includes('pre-season')) {
                    isPreseason = true;
                }
            }
        });

        if (todayGames.length === 0) {
            console.log(`No games found for ${targetDate}. Exiting cleanly.`);
            return;
        }

        if (isPreseason) {
            console.log(`Preseason games detected for ${targetDate}. Skipping auto-save to official records.`);
            return;
        }

        const activeTeamsLower = new Set();
        todayGames.forEach(g => { 
            if (g.team1) activeTeamsLower.add(g.team1.toLowerCase());
            if (g.team2) activeTeamsLower.add(g.team2.toLowerCase());
        });
        console.log(`Found ${todayGames.length} games. Processing active teams: ${Array.from(activeTeamsLower).join(', ')}`);

        // 2. Parse Players & Find Sport IDs
        const pHeaders = playersCsv[0].map(h => h.toLowerCase());
        const uIdx = pHeaders.findIndex(h => h === 'username');
        const uidIdx = pHeaders.findIndex(h => h.includes('user id') || h.includes('userid'));
        const teamIdx = pHeaders.findIndex(h => h === 'team');
        const playIdx = pHeaders.findIndex(h => h.includes('playing'));
        
        // --- DATE SPECIFIC LINEUP FIX ---
        const specificDateIdx = pHeaders.findIndex(h => h === targetDate.toLowerCase());

        const sportIdIndices = {};
        pHeaders.forEach((h, i) => {
            const m = h.match(/^([a-z]+) id$/);
            if (m && h !== 'user id' && h !== 'draft id') sportIdIndices[m[1].toUpperCase()] = i;
        });

        const allPlayerData = {};
        const fetchQueue = [];

        playersCsv.slice(1).forEach(row => {
            const team = row[teamIdx]?.trim();
            
            // --- DATE SPECIFIC LINEUP FIX ---
            let isPlaying = true;
            if (specificDateIdx > -1 && row[specificDateIdx] !== undefined && row[specificDateIdx].trim() !== '') {
                const val = row[specificDateIdx].trim().toLowerCase();
                isPlaying = val === 'yes' || val === 'true' || val === '1';
            } else if (playIdx > -1 && row[playIdx] !== undefined && row[playIdx].trim() !== '') {
                const val = row[playIdx].trim().toLowerCase();
                isPlaying = val === 'yes' || val === 'true' || val === '1';
            }
            
            if (team && activeTeamsLower.has(team.toLowerCase()) && isPlaying) {
                const userId = row[uidIdx]?.trim();
                const username = row[uIdx]?.trim();
                if (!userId) return;

                if (!allPlayerData[userId]) {
                    allPlayerData[userId] = { userId, username, team, scoresBySport: {}, lineupsBySport: {} };
                }

                // Look for Draft IDs for this player and queue them up
                for (const sport in sportIdIndices) {
                    const draftId = row[sportIdIndices[sport]]?.trim();
                    if (draftId) {
                        fetchQueue.push({
                            url: `https://web.realsports.io/games/playerratingcontest/${draftId}/view/${userId}?contestType=sport&source=home`,
                            userId: userId,
                            sport: sport
                        });
                    }
                }
            }
        });

        console.log(`Queued ${fetchQueue.length} specific draft API requests...`);

        // 3. Fetch Stats Sequentially (Safe Node.js pacing)
        for (let i = 0; i < fetchQueue.length; i++) {
            const req = fetchQueue[i];
            const pData = allPlayerData[req.userId];
            
            try {
                const data = await fetchRealDraftStats(req.url);
                
                // Extract score safely
                let scoreDisplay = '0';
                if (data.info?.rankDisplayInfos?.length > 0) {
                    scoreDisplay = data.info.rankDisplayInfos[0].scoreDisplay || '0';
                } else if (data.rankDisplayInfos?.length > 0) {
                    scoreDisplay = data.rankDisplayInfos[0].scoreDisplay || '0';
                } else if (data.scoreDisplay) {
                    scoreDisplay = data.scoreDisplay;
                } else if (data.info?.score !== undefined) {
                    scoreDisplay = data.info.score;
                } else if (data.score !== undefined) {
                    scoreDisplay = data.score;
                }
                
                const finalScore = parseFloat(String(scoreDisplay).replace(/,/g, '')) || 0;
                pData.scoresBySport[req.sport] = finalScore;

                // Extract Lineup
                let extractedLineup = data.lineup || data.playerLineups || data.contestPlayerLineup || data.lineups || [];
                if (!Array.isArray(extractedLineup)) {
                    if (extractedLineup.players) extractedLineup = extractedLineup.players;
                    else if (extractedLineup.items) extractedLineup = extractedLineup.items;
                    else extractedLineup = [];
                }
                pData.lineupsBySport[req.sport] = extractedLineup;

                if (data.info?.user?.userName || data.user?.userName) {
                    pData.username = data.info?.user?.userName || data.user?.userName;
                }

                if (i % 10 === 0) console.log(`Processed ${i}/${fetchQueue.length} requests...`);

            } catch (e) {
                console.error(`Failed to fetch ${req.sport} for ${pData.username}:`, e.message);
            }
            
            await sleep(350); // Standard pacing
        }

        // 4. Duplicate Logic
        console.log("Applying duplicate rules...");
        const draftUserIds = new Set(['jvbb41pv', 'kvMbxE63', 'R37kAWO3', 'gv8D5Q0v', 'xnrGDpRJ', 'gv8dYyPv', 'lnEw4avw', 'WJqLyqAn']);
        const hashes = new Map();

        Object.values(allPlayerData).forEach(p => {
            for (const s in p.lineupsBySport) {
                const l = p.lineupsBySport[s];
                if (!Array.isArray(l) || !l.length) continue;
                
                const h = `${s}:${l.map(x => {
                    const lp = x.player || x;
                    return (lp.displayName || x.displayName || lp.name || x.name || '').trim();
                }).join(',')}`;
                
                if (!hashes.has(h)) hashes.set(h, []);
                hashes.get(h).push({ player: p, sport: s, score: p.scoresBySport[s] || 0 });
            }
        });

        for (const entries of hashes.values()) {
            if (entries.length <= 1) continue;

            const draftAccounts = entries.filter(e => draftUserIds.has(e.player.userId));
            const teamGroups = {};

            entries.forEach(e => {
                if (!teamGroups[e.player.team]) teamGroups[e.player.team] = [];
                teamGroups[e.player.team].push(e);
            });

            // 1. Same-team duplicates (void specific sport for lower score)
            Object.values(teamGroups).forEach(teamEntries => {
                if (teamEntries.length > 1) {
                    teamEntries.sort((a, b) => b.score - a.score);
                    for (let i = 1; i < teamEntries.length; i++) {
                        if (teamEntries[i].player.scoresBySport[teamEntries[i].sport] > 0) {
                            teamEntries[i].player.scoresBySport[teamEntries[i].sport] = 0;
                            console.log(`Voided: ${teamEntries[i].player.username} (${teamEntries[i].sport}) - Same Team Duplicate`);
                        }
                    }
                }
            });

            // 2. Draft account duplicates
            if (draftAccounts.length > 0) {
                entries.forEach(e => {
                    if (!draftUserIds.has(e.player.userId)) {
                        let voided = false;
                        draftAccounts.forEach(da => {
                            if (da.player.userId !== 'WJqLyqAn' || e.sport === 'NHL') voided = true;
                        });
                        if (voided && e.player.scoresBySport[e.sport] > 0) {
                            e.player.scoresBySport[e.sport] = 0;
                            console.log(`Voided: ${e.player.username} (${e.sport}) - Draft Account Duplicate`);
                        }
                    }
                });
            }
        }

        // 5. Prepare Payload
        const gamesToLog = [];
        const playerStatsToLog = [];

        Object.values(allPlayerData).forEach(player => {
            for (const sport in player.scoresBySport) {
                const score = player.scoresBySport[sport];
                if (typeof score === 'number') {
                    playerStatsToLog.push({
                        username: player.username, userId: player.userId, team: player.team, score, sport
                    });
                }
            }
        });

        todayGames.forEach(game => {
            const t1 = game.team1, t2 = game.team2;
            let t1Score = 0, t2Score = 0, t1SeriesWins = 0, t2SeriesWins = 0;

            const p1 = Object.values(allPlayerData).filter(p => p.team.toLowerCase() === t1.toLowerCase());
            const p2 = Object.values(allPlayerData).filter(p => p.team.toLowerCase() === t2.toLowerCase());
            
            const allSports = new Set();
            [...p1, ...p2].forEach(p => Object.keys(p.scoresBySport).forEach(s => allSports.add(s)));

            [...allSports].forEach(sport => {
                const s1 = p1.reduce((sum, p) => sum + (typeof p.scoresBySport[sport] === 'number' ? p.scoresBySport[sport] : 0), 0);
                const s2 = p2.reduce((sum, p) => sum + (typeof p.scoresBySport[sport] === 'number' ? p.scoresBySport[sport] : 0), 0);
                if (s1 > s2) t1SeriesWins++;
                else if (s2 > s1) t2SeriesWins++;
                t1Score += s1; t2Score += s2;
            });

            let winner = t1SeriesWins > t2SeriesWins ? t1 : (t2SeriesWins > t1SeriesWins ? t2 : (t1Score > t2Score ? t1 : t2));
            gamesToLog.push({ team1: t1, team2: t2, team1score: parseFloat(t1Score.toFixed(2)), team2score: parseFloat(t2Score.toFixed(2)), winner, team1SeriesWins: t1SeriesWins, team2SeriesWins: t2SeriesWins });
        });

        // 6. Send to Google Sheets Queue
        console.log("Sending queue payload to Google Sheets...");
        
        const payload = {
            action: 'log_games',
            date: targetDate,
            season: SEASON,
            isPlayoff: isPlayoff,
            games: gamesToLog,
            playerStats: playerStatsToLog
        };

        const postRes = await fetch(APPS_SCRIPT_URL_SCORES, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // SAFE HEADERS ONLY
            body: JSON.stringify(payload)
        });

        const rawResponse = await postRes.text();
        
        console.log("\n========================================================");
        console.log("RAW GOOGLE RESPONSE:");
        console.log(rawResponse.substring(0, 1500)); 
        console.log("========================================================\n");

        // Now attempt to parse it safely
        const postResult = JSON.parse(rawResponse);
        console.log("Google Sheets Response:", postResult);

    } catch (err) {
        console.error("CRITICAL SCRIPT ERROR:", err);
        process.exit(1);
    }
}

run();
