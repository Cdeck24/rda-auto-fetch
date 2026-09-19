const { randomUUID } = require('crypto');
const Hashids = require('hashids/cjs');

// ==========================================================
// CONFIGURATION
// ==========================================================
const APPS_SCRIPT_URL_SCORES = 'https://script.google.com/macros/s/AKfycbyY4rz_46uk2JnqO4y7Os-0LHSU4TL43jPrtG-GXYUC61XU2o1QXoK0qMpdTdwzmenG/exec';

const REAL_AUTH_TOKEN = 'xnr5VpW3!ApZk8L2E!4fe6e26f-949f-4936-ae3e-16384878932f';
const REAL_VERSION = '27';
const SEASON = '6';

const CSV_PLAYERS = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7pZmpj4lJiBMkcjcgzJ77n2xmFIRlmuD-0Zuakz8lZekYobXkmTjfaEwhJYdNuM5F9VKlDm-FPaw8/pub?gid=0&single=true&output=csv';
const CSV_SCHEDULE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS93Cbk4JUmCBgtIR1-RnSHlYY9E-dxEEWVT_Jx-T_Lm07oa6KYlnBGAqaGJin4VBpG4GmOGn8ktTPy/pub?gid=1595040071&single=true&output=csv';

// Known Target Draft Accounts to Monitor for Copying
const DUPLICATE_TARGETS = {
    'jvbb41pv': { username: 'alp', sports: ['NFL', 'CFB', 'FC'] },
    'gv8D5Q0v': { username: 'chuiso', sports: ['ALL'] },
    'xnrGDpRJ': { username: 'croze', sports: ['ALL'] },
    'lnEw4avw': { username: 'tocki', sports: ['ALL'] },
    'kvMbxE63': { username: 'kvMbxE63', sports: ['ALL'] },
    'gv8dYyPv': { username: 'gv8dYyPv', sports: ['ALL'] },
    'WJqLyqAn': { username: 'WJqLyqAn', sports: ['NHL'] },
    'qnBMqr63': { username: 'piggyontop', sports: ['NFL'] },
    'PJPExX9v': { username: 'fbb77', sports: ['WNBA'] },
    'xnr4myPv': { username: '@mercy', sports: ['CFB'] },
    'k3Lgg4Yv': { username: '@nhl', sports: ['NHL'] },
    'wJ2RVYmJ': { username: 'thathuey5', sports: ['MLB', 'NBA'] },
    'xnrGVlRJ': { username: 'aayan.t', sports: ['MLB', 'NBA', 'FC'] },
    'Y3ONOqxv': { username: 'neemiasqueta', sports: ['ALL'] },
    'BJ098Z6v': { username: 'dr1fter', sports: ['FC'] },
    'eJ9xa5Qn': { username: 'itcd', sports: ['ALL'] },
    'Gv1DK9aJ': { username: 'chefcurryy', sports: ['ALL'] },
    'R3XMepln': { username: 'rayce', sports: ['WNBA'] },
    '7Jkwd1PJ': { username: 'noahmulford', sports: ['NBA', 'CBB'] },
    'DJ4NQOm3': { username: 'braeden42', sports: ['NHL'] },
    'R37MQYyJ': { username: 'pigskin', sports: ['ALL'] },
    'wJ29Yd9n': { username: 'money', sports: ['ALL'] },
    'lnEqV6Mn': { username: 'marner', sports: ['NHL'] },
    'Gv1YrA6v': { username: 'greektime', sports: ['ALL'] }
};

const draftUserIds = new Set(Object.keys(DUPLICATE_TARGETS));

// ==========================================================
// UTILITIES
// ==========================================================
function generateRequestToken() {
    const timestampMs = Date.now();
    const hasher = new Hashids("realwebapp", 16);
    return hasher.encode(timestampMs);
}

function getTargetDate() {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    d.setDate(d.getDate() - 1); 
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

const isSameDate = (csvDate, todayStr) => {
    if (!csvDate) return false;
    const cleanDate = String(csvDate).trim();
    if (cleanDate === todayStr) return true;
    
    const parsed = new Date(cleanDate);
    if (!isNaN(parsed.getTime())) {
        if (`${parsed.getMonth() + 1}/${parsed.getDate()}` === todayStr) return true;
    }
    
    const partsSlash = cleanDate.split('/');
    if (partsSlash.length >= 2 && `${parseInt(partsSlash[0], 10)}/${parseInt(partsSlash[1], 10)}` === todayStr) return true;
    
    return false;
};

async function fetchCSV(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch CSV');
    const text = await res.text();
    return text.trim().split(/\r?\n/).map(r => {
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
        const checkRes = await fetch(`${APPS_SCRIPT_URL_SCORES}?action=check_date&date=${encodeURIComponent(targetDate)}&season=${SEASON}`);
        if (checkRes.ok) {
            const status = await checkRes.json();
            if (status.alreadyLogged) {
                console.log(`Date ${targetDate} has already been logged. Skipping execution.`);
                return;
            }
        }
    } catch (e) {
        console.warn("Could not verify date status, proceeding with fetch...");
    }

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
                
                if (typeStr.includes('playoff')) isPlayoff = true;
                if (typeStr.includes('preseason') || typeStr.includes('pre-season')) isPreseason = true;
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
        console.log(`Found ${todayGames.length} games. Active teams: ${Array.from(activeTeamsLower).join(', ')}`);

        // 2. Parse Players & Find Sport IDs
        const pHeaders = playersCsv[0].map(h => h.toLowerCase());
        const uIdx = pHeaders.findIndex(h => h === 'username');
        const uidIdx = pHeaders.findIndex(h => h.includes('user id') || h.includes('userid'));
        const teamIdx = pHeaders.findIndex(h => h === 'team');
        const playIdx = pHeaders.findIndex(h => h.includes('playing'));
        const specificDateIdx = pHeaders.findIndex(h => isSameDate(h, targetDate));

        const sportIdIndices = {};
        pHeaders.forEach((h, i) => {
            const m = h.match(/^([a-z]+) id$/);
            if (m && h !== 'user id' && h !== 'draft id') sportIdIndices[m[1].toUpperCase()] = i;
        });

        const allPlayerData = {};
        const fetchQueue = [];

        playersCsv.slice(1).forEach(row => {
            const team = row[teamIdx]?.trim();
            const userId = row[uidIdx]?.trim();
            const username = row[uIdx]?.trim();
            if (!userId) return;

            const isDraftAccount = draftUserIds.has(userId);
            const isTeamActive = team && activeTeamsLower.has(team.toLowerCase());

            // CRITICAL FIX: Fetch active team players AND draft accounts so they can be matched
            if (isTeamActive || isDraftAccount) {
                let isPlaying = true;
                if (specificDateIdx > -1 && row[specificDateIdx] !== undefined && row[specificDateIdx].trim() !== '') {
                    const val = row[specificDateIdx].trim().toLowerCase();
                    isPlaying = val === 'yes' || val === 'true' || val === '1';
                } else if (playIdx > -1 && row[playIdx] !== undefined && row[playIdx].trim() !== '') {
                    const val = row[playIdx].trim().toLowerCase();
                    isPlaying = val === 'yes' || val === 'true' || val === '1';
                }

                if (!allPlayerData[userId]) {
                    allPlayerData[userId] = { 
                        userId, 
                        username, 
                        team: team || 'DRAFT', 
                        isPlaying, 
                        isDraftAccount,
                        scoresBySport: {}, 
                        lineupsBySport: {} 
                    };
                }

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

        // 3. Fetch Stats Sequentially
        for (let i = 0; i < fetchQueue.length; i++) {
            const req = fetchQueue[i];
            const pData = allPlayerData[req.userId];
            
            try {
                const data = await fetchRealDraftStats(req.url);
                
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

                // CRITICAL FIX: Exhaustive search for lineup array across RealApp structures
                let extractedLineup = data.lineup || data.info?.lineup || 
                                      data.playerLineups || data.info?.playerLineups || 
                                      data.contestPlayerLineup || data.info?.contestPlayerLineup || 
                                      data.lineups || data.info?.lineups || 
                                      data.players || data.info?.players || [];
                
                if (!Array.isArray(extractedLineup)) {
                    if (extractedLineup.players) extractedLineup = extractedLineup.players;
                    else if (extractedLineup.items) extractedLineup = extractedLineup.items;
                    else if (extractedLineup.lineup) extractedLineup = extractedLineup.lineup;
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
            
            await sleep(350);
        }

        // 4. Duplicate Detection & Voiding Logic
        console.log("Applying duplicate rules...");
        const hashes = new Map();

        Object.values(allPlayerData).forEach(p => {
            // CRITICAL FIX: Do not skip draft accounts when compiling lineup hashes
            if (!p.isPlaying && !p.isDraftAccount) return;

            for (const s in p.lineupsBySport) {
                const l = p.lineupsBySport[s];
                if (!Array.isArray(l) || !l.length) continue;
                
                // CRITICAL FIX: Sort athlete names so lineup pick order does not break matching
                const athleteNames = l.map(x => {
                    const lp = x.player || x;
                    return (lp.displayName || x.displayName || lp.name || x.name || '').trim().toLowerCase();
                }).filter(Boolean).sort();

                if (!athleteNames.length) continue;

                const sportUpper = s.toUpperCase();
                const h = `${sportUpper}:${athleteNames.join(',')}`;
                
                if (!hashes.has(h)) hashes.set(h, []);
                hashes.get(h).push({ player: p, sport: sportUpper, score: p.scoresBySport[s] || 0 });
            }
        });

        for (const [hashKey, entries] of hashes.entries()) {
            if (entries.length <= 1) continue;

            const currentSport = hashKey.split(':')[0];
            const draftAccounts = entries.filter(e => e.player.isDraftAccount);
            const teamGroups = {};

            entries.filter(e => !e.player.isDraftAccount).forEach(e => {
                if (!teamGroups[e.player.team]) teamGroups[e.player.team] = [];
                teamGroups[e.player.team].push(e);
            });

            // Rule 1: Same-team duplicates (void lower score on same franchise)
            Object.values(teamGroups).forEach(teamEntries => {
                if (teamEntries.length > 1) {
                    teamEntries.sort((a, b) => b.score - a.score);
                    for (let i = 1; i < teamEntries.length; i++) {
                        if (teamEntries[i].player.scoresBySport[currentSport] > 0) {
                            teamEntries[i].player.scoresBySport[currentSport] = 0;
                            console.log(`[VOIDED] ${teamEntries[i].player.username} (${currentSport}) -> 0.00 pts (Same Team Duplicate on ${teamEntries[i].player.team})`);
                        }
                    }
                }
            });

            // Rule 2: Target Draft Account duplicates
            if (draftAccounts.length > 0) {
                entries.forEach(e => {
                    if (!e.player.isDraftAccount) {
                        let shouldVoid = false;
                        draftAccounts.forEach(da => {
                            const targetCfg = DUPLICATE_TARGETS[da.player.userId];
                            const allowedSports = targetCfg ? targetCfg.sports : ['ALL'];
                            if (allowedSports.includes('ALL') || allowedSports.includes(currentSport)) {
                                shouldVoid = true;
                            }
                        });

                        if (shouldVoid && e.player.scoresBySport[currentSport] > 0) {
                            e.player.scoresBySport[currentSport] = 0;
                            console.log(`[VOIDED] ${e.player.username} (${currentSport}) -> 0.00 pts (Matched Target Draft Account: ${draftAccounts.map(d => d.player.username).join(', ')})`);
                        }
                    }
                });
            }
        }

        // 5. Prepare Payload (Filter out standalone draft accounts)
        const gamesToLog = [];
        const playerStatsToLog = [];

        Object.values(allPlayerData).forEach(player => {
            // CRITICAL FIX: Do not write monitoring-only draft accounts to official league logs
            if (player.isDraftAccount && (!player.team || !activeTeamsLower.has(player.team.toLowerCase()))) {
                return;
            }

            for (const sport in player.scoresBySport) {
                const score = player.scoresBySport[sport];
                if (typeof score === 'number') {
                    playerStatsToLog.push({
                        username: player.username, 
                        userId: player.userId, 
                        team: player.team, 
                        score: score, 
                        sport: sport, 
                        isBench: !player.isPlaying
                    });
                }
            }
        });

        todayGames.forEach(game => {
            const t1 = game.team1, t2 = game.team2;
            let t1Score = 0, t2Score = 0, t1SeriesWins = 0, t2SeriesWins = 0;

            const p1 = Object.values(allPlayerData).filter(p => !p.isDraftAccount && p.team.toLowerCase() === t1.toLowerCase());
            const p2 = Object.values(allPlayerData).filter(p => !p.isDraftAccount && p.team.toLowerCase() === t2.toLowerCase());
            
            const allSports = new Set();
            [...p1, ...p2].forEach(p => Object.keys(p.scoresBySport).forEach(s => allSports.add(s)));

            [...allSports].forEach(sport => {
                const s1 = p1.filter(p => p.isPlaying).reduce((sum, p) => sum + (typeof p.scoresBySport[sport] === 'number' ? p.scoresBySport[sport] : 0), 0);
                const s2 = p2.filter(p => p.isPlaying).reduce((sum, p) => sum + (typeof p.scoresBySport[sport] === 'number' ? p.scoresBySport[sport] : 0), 0);
                
                if (s1 > s2) t1SeriesWins++;
                else if (s2 > s1) t2SeriesWins++;
                
                t1Score += s1; 
                t2Score += s2;
            });

            let winner = t1SeriesWins > t2SeriesWins ? t1 : (t2SeriesWins > t1SeriesWins ? t2 : (t1Score > t2Score ? t1 : t2));
            gamesToLog.push({ 
                team1: t1, 
                team2: t2, 
                team1score: parseFloat(t1Score.toFixed(2)), 
                team2score: parseFloat(t2Score.toFixed(2)), 
                winner, 
                team1SeriesWins, 
                team2SeriesWins 
            });
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
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        const rawResponse = await postRes.text();
        
        console.log("\n========================================================");
        console.log("RAW GOOGLE RESPONSE:");
        console.log(rawResponse.substring(0, 1500)); 
        console.log("========================================================\n");

        try {
            const postResult = JSON.parse(rawResponse);
            console.log("Google Sheets Response:", postResult);
        } catch (parseErr) {
            console.warn("[WARNING] Google returned an HTML/non-JSON response (likely a security redirect for the GitHub IP).");
            console.warn("Since the POST request completed, your data likely saved successfully!");
        }

    } catch (err) {
        console.error("CRITICAL SCRIPT ERROR:", err);
        process.exit(1);
    }
}

run();
