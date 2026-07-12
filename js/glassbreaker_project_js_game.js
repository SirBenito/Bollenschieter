(() => {
    'use strict';

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const startScreen = document.getElementById('start-screen');
    const pauseScreen = document.getElementById('pause-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const vibeToggle = document.getElementById('vibe-toggle');
    const menuHighScore = document.getElementById('menu-high-score');

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const randomBetween = (min, max) => min + Math.random() * (max - min);

    let width = 0, height = 0, BLOCK_SIZE = 0, FIRE_ZONE_Y = 0;
    const BLOCK_COLS = 6, BALL_RADIUS = 6, TOP_OFFSET = 78;

    let state = 'MENU', resumeState = 'AIMING', pendingResize = false;
    let wave = 1, score = 0, highScore = readHighScore();
    let blocksShattered = 0, maxCombo = 0, cleanSweeps = 0;
    let totalBalls = 5, baseTotalBalls = 5, shieldCharges = 0, wavesSinceBallItem = 0;

    let balls = [], blocks = [], items = [], particles = [], floatingTexts = [];
    let startX = 0, startY = 0, mouseX = 0, mouseY = 0, isDragging = false;
    let keyboardAngle = -Math.PI / 2, ballsFired = 0, ballsLanded = 0, comboCount = 0;
    let fireTimer = null, activeShotAngle = -Math.PI / 2;
    let shakeTimer = 0, shakeIntensity = 0, bannerText = '', bannerSubtext = '', bannerLife = 0;
    let dangerFlash = 0, vibrationEnabled = true, audioReady = false;
    let synth = null, polySynth = null, noiseSynth = null;
    let lastTime = 0; // toegevoegd voor delta time

    const THEME = {
        BALL: '#ffffff', GRID: 'rgba(255, 255, 255, 0.20)', TEXT_MAIN: '#2c3e50',
        ACCENT_BLUE: '#3a86ff', ACCENT_PINK: '#ff006e', ACCENT_YELLOW: '#ffbe0b',
        ACCENT_GREEN: '#27ae60', ACCENT_PURPLE: '#8e44ad',
        COLORS: ['#ff99c8', '#fcf6bd', '#d0f4de', '#a9def9', '#e4c1f9']
    };

    function readHighScore() {
        try { return Number(localStorage.getItem('glassBreakerHighScore') || 0); }
        catch (_) { return 0; }
    }

    function storeHighScore() {
        highScore = Math.max(highScore, score);
        menuHighScore.textContent = String(highScore);
        try { localStorage.setItem('glassBreakerHighScore', String(highScore)); }
        catch (_) { }
    }

    function resizeGame(force = false) {
        if (!force && (state === 'SHOOTING' || state === 'WAITING')) {
            pendingResize = true;
            return;
        }

        const oldWidth = width || Math.min(window.innerWidth - 16, 460);
        width = Math.max(300, Math.min(window.innerWidth - 16, 460));
        height = Math.max(500, Math.min((window.innerHeight || document.documentElement.clientHeight) - 16, 800));
        BLOCK_SIZE = width / BLOCK_COLS;
        FIRE_ZONE_Y = height - 122;

        canvas.width = Math.round(width * Math.min(window.devicePixelRatio || 1, 2));
        canvas.height = Math.round(height * Math.min(window.devicePixelRatio || 1, 2));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const scale = canvas.width / width;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        const relativeStart = oldWidth ? startX / oldWidth : 0.5;
        startX = clamp(relativeStart * width, 20, width - 20);
        startY = height - 88;
        mouseX = startX;
        mouseY = startY - 120;

        blocks.forEach(block => block.reposition());
        items.forEach(item => item.reposition());
        pendingResize = false;
    }

    function triggerVibration(pattern) {
        if (!vibrationEnabled || !navigator.vibrate) return;
        try { navigator.vibrate(pattern); } catch (_) {}
    }

    vibeToggle.addEventListener('change', event => {
        vibrationEnabled = event.target.checked;
        if (vibrationEnabled) triggerVibration(30);
    });

    async function initAudio() {
        if (audioReady || typeof Tone === 'undefined') return;
        try {
            await Tone.start();
            synth = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0.08, release: 0.08 } }).toDestination();
            synth.volume.value = -17;

            polySynth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.04, decay: 0.18, sustain: 0.22, release: 0.18 } }).toDestination();
            polySynth.volume.value = -24;

            noiseSynth = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.05, sustain: 0, release: 0.04 } }).toDestination();
            noiseSynth.volume.value = -21;

            const sequenceNotes = [['C4', 'G4'], ['Eb4', 'Bb4'], ['F4', 'C5'], ['G4', 'D5']];
            let step = 0;
            Tone.Transport.scheduleRepeat(time => {
                if (['AIMING', 'SHOOTING', 'WAITING'].includes(state)) {
                    polySynth.triggerAttackRelease(sequenceNotes[step % sequenceNotes.length], '8n', time);
                    step++;
                }
            }, '4n');
            Tone.Transport.bpm.value = 116;
            Tone.Transport.start();
            audioReady = true;
        } catch (error) { console.warn('Audio kon niet starten:', error); }
    }

    function safeNote(note, duration = '32n') { try { if (synth) synth.triggerAttackRelease(note, duration); } catch (_) {} }
    function playHitSound() { safeNote('E5'); }
    function playShootSound() { safeNote('C4'); }
    function playItemSound() { safeNote('G5'); setTimeout(() => safeNote('C6', '16n'), 70); }
    function playShatterSound() {
        safeNote('A5', '16n');
        setTimeout(() => safeNote('E6'), 45);
        try { if (noiseSynth) noiseSynth.triggerAttackRelease('32n'); } catch (_) {}
    }
    function playExplosionSound() {
        safeNote('C3', '8n');
        try { if (noiseSynth) noiseSynth.triggerAttackRelease('8n'); } catch (_) {}
    }

    class Ball {
        constructor(x, y) {
            this.x = x; this.y = y; this.vx = 0; this.vy = 0;
            this.radius = BALL_RADIUS; this.active = true;
            this.speed = clamp(width * 0.026, 9.2, 12.2);
            this.trail = []; this.hitCooldown = new Map();
        }

        update(dt) {
            if (!this.active) return;
            const timeScale = dt / 16.66; // 60fps base
            
            this.trail.unshift({ x: this.x, y: this.y });
            if (this.trail.length > 6) this.trail.pop();

            const subSteps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) / 7));
            for (let step = 0; step < subSteps && this.active; step++) {
                this.x += (this.vx * timeScale) / subSteps;
                this.y += (this.vy * timeScale) / subSteps;
                this.handleWalls();
                if (!this.active) break;
                checkBallItemCollisions(this);
                if (checkBallBlockCollision(this)) break;
            }

            for (const [key, value] of this.hitCooldown.entries()) {
                if (value <= 1) this.hitCooldown.delete(key);
                else this.hitCooldown.set(key, value - 1);
            }
        }

        handleWalls() {
            if (this.x - this.radius < 0) { this.x = this.radius; this.vx = Math.abs(this.vx); playHitSound(); }
            else if (this.x + this.radius > width) { this.x = width - this.radius; this.vx = -Math.abs(this.vx); playHitSound(); }
            
            if (this.y - this.radius < 0) { this.y = this.radius; this.vy = Math.abs(this.vy); playHitSound(); }
            
            if (this.y + this.radius > height) {
                this.active = false;
                ballsLanded++;
                if (ballsLanded === 1) startX = clamp(this.x, 20, width - 20);
                if (ballsLanded >= totalBalls && ballsFired >= totalBalls) endTurn();
            }
        }

        draw() {
            this.trail.forEach((pos, index) => {
                const alpha = 0.36 * (1 - index / this.trail.length);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, this.radius * (1 - index / (this.trail.length + 1)), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                ctx.fill();
            });

            if (!this.active) return;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = THEME.BALL;
            ctx.shadowBlur = 4; // Optimized from 8
            ctx.shadowColor = 'rgba(255,255,255,.85)';
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    class Block {
        constructor(row, col, hp, options = {}) {
            this.id = `${Date.now()}-${Math.random()}`;
            this.row = row; this.col = col; this.hp = hp; this.maxHp = hp;
            this.isBomb = Boolean(options.isBomb); this.isArmored = Boolean(options.isArmored);
            this.detonated = false; this.color = THEME.COLORS[Math.floor(Math.random() * THEME.COLORS.length)];
            this.reposition();
        }
        reposition() {
            this.w = BLOCK_SIZE - 4; this.h = BLOCK_SIZE - 4;
            this.x = this.col * BLOCK_SIZE + 2; this.y = this.row * BLOCK_SIZE + TOP_OFFSET;
            this.centerX = this.x + this.w / 2; this.centerY = this.y + this.h / 2;
        }
        draw() {
            const radius = 8;
            ctx.save(); ctx.beginPath(); ctx.roundRect(this.x, this.y, this.w, this.h, radius); ctx.clip();
            ctx.fillStyle = this.isBomb ? 'rgba(255, 92, 92, .58)' : this.color;
            ctx.globalAlpha = this.isArmored ? 0.68 : 0.52;
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.globalAlpha = 1;
            ctx.restore();
            ctx.beginPath(); ctx.roundRect(this.x, this.y, this.w, this.h, radius);
            ctx.strokeStyle = this.isBomb ? 'rgba(220,38,38,.9)' : 'rgba(255,255,255,.68)';
            ctx.lineWidth = this.isArmored ? 3.5 : 2; ctx.stroke();
            ctx.fillStyle = this.isBomb ? '#b91c1c' : THEME.TEXT_MAIN;
            ctx.font = `bold ${Math.max(10, Math.min(13, BLOCK_SIZE * .17))}px "Press Start 2P"`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(this.hp), this.centerX, this.centerY + (this.isBomb ? 8 : 1));
            if (this.isBomb) { ctx.font = `${Math.max(15, BLOCK_SIZE * .27)}px "Inter"`; ctx.fillText('💣', this.centerX, this.centerY - 11); }
            else if (this.isArmored) { ctx.font = `bold ${Math.max(9, BLOCK_SIZE * .15)}px "Inter"`; ctx.fillStyle = 'rgba(51,65,85,.75)'; ctx.fillText('◆', this.centerX, this.y + 13); }
        }
    }

    class PowerItem {
        constructor(row, col, type) {
            this.row = row; this.col = col; this.type = type; this.radius = 11;
            this.pulse = Math.random() * Math.PI * 2; this.reposition();
        }
        reposition() {
            this.x = this.col * BLOCK_SIZE + BLOCK_SIZE / 2;
            this.y = this.row * BLOCK_SIZE + TOP_OFFSET + BLOCK_SIZE / 2;
        }
        update(dt) { this.pulse += 0.055 * (dt/16); }
        draw() {
            const styles = { ball: { icon: '+', color: THEME.ACCENT_BLUE, glow: 'rgba(58,134,255,.28)' }, laser: { icon: '⚡', color: THEME.ACCENT_YELLOW, glow: 'rgba(255,190,11,.30)' }, shield: { icon: '◇', color: THEME.ACCENT_PURPLE, glow: 'rgba(142,68,173,.28)' } };
            const style = styles[this.type]; const pulseRadius = this.radius + Math.sin(this.pulse) * 3;
            ctx.beginPath(); ctx.arc(this.x, this.y, pulseRadius, 0, Math.PI * 2); ctx.fillStyle = style.glow; ctx.fill();
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = style.color; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
            ctx.fillStyle = style.color; ctx.font = `bold ${this.type === 'laser' ? 14 : 13}px "Press Start 2P"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(style.icon, this.x, this.y + 1);
        }
    }

    class GlassParticle {
        constructor(x, y, color, force = 1) {
            this.x = x; this.y = y; const angle = Math.random() * Math.PI * 2; const speed = randomBetween(2, 5.5) * force;
            this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
            this.life = 1; this.color = color; this.size = randomBetween(2, 6);
            this.rot = Math.random() * Math.PI; this.rotSpeed = randomBetween(-.12, .12);
        }
        update(dt) {
            const timeScale = dt / 16.66;
            this.x += this.vx * timeScale; this.y += this.vy * timeScale; this.vy += .15 * timeScale;
            this.rot += this.rotSpeed * timeScale; this.life -= .03 * timeScale;
        }
        draw() {
            if (this.life <= 0) return;
            ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot); ctx.globalAlpha = this.life;
            ctx.fillStyle = this.color; ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
            ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(-this.size / 2, -this.size / 2, this.size, this.size);
            ctx.restore();
        }
    }

    class FloatingText {
        constructor(text, x, y, color, size = 12) {
            this.text = text; this.x = x; this.y = y; this.color = color; this.life = 1; this.size = size;
        }
        update(dt) { const timeScale = dt / 16.66; this.y -= 1 * timeScale; this.life -= .024 * timeScale; }
        draw() {
            if (this.life <= 0) return;
            ctx.save(); ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.font = `800 ${this.size}px "Inter"`;
            ctx.textAlign = 'center'; ctx.fillText(this.text, this.x, this.y); ctx.restore();
        }
    }

    function createGlassShatter(x, y, color, amount = 14, force = 1) { for (let index = 0; index < amount; index++) particles.push(new GlassParticle(x, y, color, force)); }
    function triggerScreenShake(intensity, duration = 8) { shakeIntensity = Math.max(shakeIntensity, intensity); shakeTimer = Math.max(shakeTimer, duration); }
    function showBanner(text, subtext = '', duration = 115) { bannerText = text; bannerSubtext = subtext; bannerLife = duration; }

    function getDangerRatio() {
        if (!blocks.length) return 0;
        const lowestBottom = Math.max(...blocks.map(block => block.y + block.h));
        return clamp((lowestBottom - TOP_OFFSET) / Math.max(1, FIRE_ZONE_Y - TOP_OFFSET), 0, 1);
    }

    function getWaveConfig() {
        const challengeWave = wave > 1 && wave % 5 === 0;
        const danger = getDangerRatio();
        const recovery = danger > .72;
        let blockCount = clamp(Math.round(2.4 + wave * .11 + (challengeWave ? 1.4 : 0)), 2, challengeWave ? 6 : 5);
        if (recovery) blockCount = Math.max(2, blockCount - 1);
        const baseHp = Math.max(1, Math.round(wave * .78 + Math.sqrt(wave) * .72));
        const hpMultiplier = (challengeWave ? 1.12 : 1) * (recovery ? .86 : 1);
        const bombChance = clamp(.075 + wave * .003, .075, .17);
        const armorChance = wave < 6 ? 0 : clamp(.045 + (wave - 6) * .004, .045, .19);
        return { challengeWave, recovery, danger, blockCount, baseHp, hpMultiplier, bombChance, armorChance };
    }

    function shuffledColumns() {
        const cols = Array.from({ length: BLOCK_COLS }, (_, index) => index);
        for (let index = cols.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [cols[index], cols[swapIndex]] = [cols[swapIndex], cols[index]];
        }
        return cols;
    }

    function spawnWave({ initial = false } = {}) {
        if (!initial) {
            blocks.forEach(block => { block.row++; block.reposition(); });
            items.forEach(item => { item.row++; item.reposition(); });
            items = items.filter(item => item.y < FIRE_ZONE_Y - 8);

            if (blocks.some(block => block.y + block.h >= FIRE_ZONE_Y)) {
                if (shieldCharges > 0) useSafetyShield();
                else { gameOver(); return; }
            }
        }

        const config = getWaveConfig();
        const columns = shuffledColumns();
        const reserved = new Set();
        let shouldSpawnBall = initial || config.challengeWave || wavesSinceBallItem >= 2 || Math.random() < (wave < 12 ? .58 : .45);
        if (config.recovery) shouldSpawnBall = true;

        if (shouldSpawnBall) { const col = columns.pop(); items.push(new PowerItem(0, col, 'ball')); reserved.add(col); wavesSinceBallItem = 0; }
        else wavesSinceBallItem++;

        const supportChance = config.challengeWave ? (config.recovery ? .45 : 0) : (config.recovery ? .72 : (wave >= 4 ? .23 : 0));
        if (columns.length && Math.random() < supportChance) {
            const col = columns.pop(); const type = shieldCharges === 0 && config.danger > .55 && Math.random() < .65 ? 'shield' : (Math.random() < .62 ? 'laser' : 'shield');
            items.push(new PowerItem(0, col, type)); reserved.add(col);
        }

        const freeCols = shuffledColumns().filter(col => !reserved.has(col));
        let bombCount = 0;
        for (let index = 0; index < Math.min(config.blockCount, freeCols.length); index++) {
            const col = freeCols[index];
            let hp = Math.max(1, Math.round(config.baseHp * config.hpMultiplier * randomBetween(.78, 1.25)));
            let isBomb = Math.random() < config.bombChance;
            if (config.challengeWave && bombCount === 0 && index === Math.min(config.blockCount, freeCols.length) - 1) isBomb = true;
            if (bombCount >= 2) isBomb = false;
            if (isBomb) { bombCount++; hp = Math.max(2, Math.round(hp * 1.18)); }
            const isArmored = !isBomb && Math.random() < config.armorChance;
            if (isArmored) hp = Math.max(3, Math.round(hp * 1.32));
            blocks.push(new Block(0, col, hp, { isBomb, isArmored }));
        }

        if (config.challengeWave) showBanner(`CHALLENGE WAVE ${wave}`, 'Meer blokken, maar ook een gegarandeerde bonus.');
        else if (config.recovery) showBanner(`WAVE ${wave}`, 'Ademruimte: lichtere rij door hoog gevaar.');
        else showBanner(`WAVE ${wave}`, wave >= 6 ? 'Versterkte blokken kunnen verschijnen.' : 'Bouw je voorraad ballen op.');
    }

    function checkBallItemCollisions(ball) {
        for (let index = items.length - 1; index >= 0; index--) {
            const item = items[index]; const dx = ball.x - item.x; const dy = ball.y - item.y;
            if (Math.hypot(dx, dy) >= ball.radius + item.radius) continue;
            items.splice(index, 1); collectItem(item);
        }
    }

    function collectItem(item) {
        playItemSound(); triggerVibration(25); createGlassShatter(item.x, item.y, '#ffffff', 8, .7);
        if (item.type === 'ball') { baseTotalBalls = Math.min(120, baseTotalBalls + 1); floatingTexts.push(new FloatingText('+1 BAL', item.x, item.y, THEME.ACCENT_BLUE, 14)); }
        else if (item.type === 'laser') { floatingTexts.push(new FloatingText('KOLOMLASER!', item.x, item.y, '#d97706', 14)); fireColumnLaser(item.col); }
        else if (item.type === 'shield') { shieldCharges = Math.min(2, shieldCharges + 1); floatingTexts.push(new FloatingText('SCHILD +1', item.x, item.y, THEME.ACCENT_PURPLE, 14)); }
    }

    function fireColumnLaser(col) {
        triggerScreenShake(4, 6); triggerVibration([20, 30, 20]);
        const x = col * BLOCK_SIZE + BLOCK_SIZE / 2;
        for (let spark = 0; spark < 28; spark++) particles.push(new GlassParticle(x, randomBetween(TOP_OFFSET, FIRE_ZONE_Y), '#ffd166', .65));
        const damage = Math.max(2, Math.round(wave * .48));
        blocks.filter(block => block.col === col).forEach(block => applyDamage(block, damage, { cause: 'laser', x, y: block.centerY }));
    }

    function checkBallBlockCollision(ball) {
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index]; if (ball.hitCooldown.has(block.id)) continue;
            const testX = clamp(ball.x, block.x, block.x + block.w); const testY = clamp(ball.y, block.y, block.y + block.h);
            const distX = ball.x - testX; const distY = ball.y - testY;
            if (Math.hypot(distX, distY) > ball.radius) continue;

            if (Math.abs(distX) > Math.abs(distY)) ball.vx *= -1; else ball.vy *= -1;
            ball.x += ball.vx * .22; ball.y += ball.vy * .22; ball.hitCooldown.set(block.id, 4);
            applyDamage(block, 1, { cause: 'ball', x: testX, y: testY });
            triggerVibration(12); playHitSound();
            return true;
        }
        return false;
    }

    function applyDamage(block, amount, { cause = 'ball', x = block.centerX, y = block.centerY } = {}) {
        if (!blocks.includes(block)) return;
        block.hp -= amount;
        createGlassShatter(x, y, block.isBomb ? '#ff6b6b' : block.color, cause === 'laser' ? 7 : 4, .55);
        if (block.hp <= 0) destroyBlock(block, cause);
    }

    function destroyBlock(block, cause = 'ball') {
        const index = blocks.indexOf(block); if (index === -1) return;
        blocks.splice(index, 1); comboCount++; maxCombo = Math.max(maxCombo, comboCount); blocksShattered++;

        const comboMultiplier = Math.min(3.5, 1 + Math.max(0, comboCount - 1) * .12);
        const typeMultiplier = block.isBomb ? 1.45 : (block.isArmored ? 1.35 : 1);
        const causeMultiplier = cause === 'explosion' ? .72 : (cause === 'shield' ? .45 : 1);
        const gained = Math.max(1, Math.floor((12 + wave * 3.1) * comboMultiplier * typeMultiplier * causeMultiplier));
        score += gained;

        createGlassShatter(block.centerX, block.centerY, block.isBomb ? '#ff5c5c' : block.color, block.isBomb ? 24 : 15, block.isBomb ? 1.25 : 1);
        floatingTexts.push(new FloatingText(`+${gained}`, block.centerX, block.y + 4, block.isBomb ? '#dc2626' : block.color, 14));
        triggerScreenShake(block.isBomb ? 8 : 4, block.isBomb ? 10 : 5); playShatterSound();

        if ([6, 12, 20, 30].includes(comboCount)) {
            const label = comboCount >= 30 ? 'GLASS STORM!' : comboCount >= 20 ? 'MEGA COMBO!' : comboCount >= 12 ? 'SUPER COMBO!' : 'COMBO!';
            floatingTexts.push(new FloatingText(label, width / 2, height * .48, THEME.ACCENT_PINK, 18));
            score += comboCount * 10;
        }

        if (block.isBomb) detonateBomb(block);
    }

    function detonateBomb(bomb) {
        if (bomb.detonated) return; bomb.detonated = true;
        triggerScreenShake(12, 12); triggerVibration([75, 45, 75]); playExplosionSound();
        floatingTexts.push(new FloatingText('BOOM!', bomb.centerX, bomb.centerY, '#b91c1c', 18));
        for (let index = 0; index < 34; index++) particles.push(new GlassParticle(bomb.centerX, bomb.centerY, '#ff6b6b', 1.45));
        blocks.filter(block => Math.abs(block.row - bomb.row) <= 1 && Math.abs(block.col - bomb.col) <= 1).forEach(block => destroyBlock(block, 'explosion'));
    }

    function useSafetyShield() {
        shieldCharges--; const lowestRow = Math.max(...blocks.map(block => block.row));
        showBanner('SCHILD GEACTIVEERD', 'De laagste rij wordt verbrijzeld.');
        triggerVibration([90, 40, 90]); triggerScreenShake(10, 12); dangerFlash = 28;
        blocks.filter(block => block.row === lowestRow).forEach(block => destroyBlock(block, 'shield'));
    }

    function shoot(angle) {
        if (state !== 'AIMING') return;
        state = 'SHOOTING'; activeShotAngle = angle; balls = []; ballsFired = 0; ballsLanded = 0; comboCount = 0; totalBalls = baseTotalBalls;
        queueNextBall();
    }

    function queueNextBall() {
        clearTimeout(fireTimer);
        if (state === 'GAMEOVER' || state === 'MENU') return;
        if (state === 'PAUSED') { fireTimer = setTimeout(queueNextBall, 80); return; }
        if (ballsFired >= totalBalls) { if (state === 'SHOOTING') state = 'WAITING'; return; }
        const ball = new Ball(startX, startY); ball.vx = Math.cos(activeShotAngle) * ball.speed; ball.vy = Math.sin(activeShotAngle) * ball.speed;
        balls.push(ball); ballsFired++; playShootSound(); fireTimer = setTimeout(queueNextBall, 82);
    }

    function endTurn() {
        if (state === 'GAMEOVER' || state === 'MENU') return; clearTimeout(fireTimer);
        if (blocks.length === 0) {
            cleanSweeps++; score += 150 + wave * 25;
            floatingTexts.push(new FloatingText(`CLEAN SWEEP +${150 + wave * 25}`, width / 2, height * .52, THEME.ACCENT_GREEN, 16));
            if (cleanSweeps % 3 === 0) { baseTotalBalls++; showBanner('CLEAN SWEEP BONUS', 'Drie clears: +1 permanente bal.'); }
        }
        wave++; state = 'AIMING'; if (pendingResize) resizeGame(true); spawnWave();
    }

    function gameOver() {
        if (state === 'GAMEOVER') return; state = 'GAMEOVER'; clearTimeout(fireTimer);
        triggerVibration([100, 140, 100, 140]); storeHighScore();
        document.getElementById('final-wave').textContent = String(wave); document.getElementById('final-score').textContent = String(score);
        document.getElementById('final-shattered').textContent = String(blocksShattered); document.getElementById('final-combo').textContent = String(maxCombo);
        pauseBtn.classList.add('hidden'); gameOverScreen.classList.remove('hidden');
    }

    function resetGame() {
        clearTimeout(fireTimer);
        wave = 1; score = 0; blocksShattered = 0; maxCombo = 0; cleanSweeps = 0; baseTotalBalls = 5; totalBalls = 5; shieldCharges = 0; wavesSinceBallItem = 0;
        balls = []; blocks = []; items = []; particles = []; floatingTexts = []; comboCount = 0;
        isDragging = false; keyboardAngle = -Math.PI / 2; startX = width / 2; startY = height - 88;
        gameOverScreen.classList.add('hidden'); pauseScreen.classList.add('hidden'); pauseBtn.classList.remove('hidden'); pauseBtn.textContent = 'Ⅱ';
        state = 'AIMING'; spawnWave({ initial: true });
    }

    function togglePause(forceResume = false) {
        if (state === 'MENU' || state === 'GAMEOVER') return;
        if (state === 'PAUSED' || forceResume) { state = resumeState; pauseScreen.classList.add('hidden'); pauseBtn.textContent = 'Ⅱ'; return; }
        resumeState = state; state = 'PAUSED'; isDragging = false; pauseScreen.classList.remove('hidden'); pauseBtn.textContent = '▶';
    }

    function pointerPosition(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * (width / rect.width), y: (event.clientY - rect.top) * (height / rect.height) };
    }

    canvas.addEventListener('pointerdown', event => { if (state !== 'AIMING') return; isDragging = true; const pos = pointerPosition(event); mouseX = pos.x; mouseY = pos.y; try { canvas.setPointerCapture(event.pointerId); } catch (_) {} event.preventDefault(); }, { passive: false });
    canvas.addEventListener('pointermove', event => { if (!isDragging || state !== 'AIMING') return; const pos = pointerPosition(event); mouseX = pos.x; mouseY = pos.y; event.preventDefault(); }, { passive: false });
    canvas.addEventListener('pointerup', event => {
        if (!isDragging || state !== 'AIMING') return; isDragging = false;
        const pos = pointerPosition(event); mouseX = pos.x; mouseY = pos.y;
        const dy = mouseY - startY;
        let angle = Math.atan2(dy, mouseX - startX); angle = clamp(angle, -Math.PI + .12, -.12); keyboardAngle = angle;
        if (dy < -15) shoot(angle); event.preventDefault();
    }, { passive: false });
    canvas.addEventListener('pointercancel', () => { isDragging = false; });

    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'p' || event.key === 'Escape') { togglePause(); return; }
        if (state !== 'AIMING') return;
        if (event.key === 'ArrowLeft') { keyboardAngle = clamp(keyboardAngle - .065, -Math.PI + .12, -.12); event.preventDefault(); }
        else if (event.key === 'ArrowRight') { keyboardAngle = clamp(keyboardAngle + .065, -Math.PI + .12, -.12); event.preventDefault(); }
        else if (event.code === 'Space' || event.key === 'Enter') { shoot(keyboardAngle); event.preventDefault(); }
    });

    pauseBtn.addEventListener('click', () => togglePause());
    resumeBtn.addEventListener('click', () => togglePause(true));
    startBtn.addEventListener('click', async () => { await initAudio(); startScreen.classList.add('hidden'); resetGame(); });
    restartBtn.addEventListener('click', () => resetGame());
    window.addEventListener('resize', () => resizeGame(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden && !['MENU', 'GAMEOVER', 'PAUSED'].includes(state)) togglePause(); });

    function drawAimGuide(angle) {
        let x = startX, y = startY, dx = Math.cos(angle), dy = Math.sin(angle);
        const points = [{ x, y }]; let remaining = Math.min(620, height * .92);
        for (let bounce = 0; bounce < 4 && remaining > 0; bounce++) {
            const tx = dx > 0 ? (width - BALL_RADIUS - x) / dx : (BALL_RADIUS - x) / dx;
            const ty = dy < 0 ? (BALL_RADIUS - y) / dy : Infinity;
            const distance = Math.min(tx > 0 ? tx : Infinity, ty > 0 ? ty : Infinity, remaining);
            if (!Number.isFinite(distance)) break;
            x += dx * distance; y += dy * distance; points.push({ x, y }); remaining -= distance;
            if (distance === ty) dy *= -1; else dx *= -1;
        }
        ctx.save(); ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = isDragging ? THEME.ACCENT_BLUE : 'rgba(58,134,255,.48)'; ctx.lineWidth = isDragging ? 2.5 : 1.5;
        ctx.setLineDash([6, 7]); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }

    function gameLoop(time) {
        const dt = time - lastTime;
        lastTime = time;

        ctx.save();
        if (shakeTimer > 0 && state !== 'PAUSED') {
            ctx.translate((Math.random() - .5) * shakeIntensity, (Math.random() - .5) * shakeIntensity);
            shakeTimer--; shakeIntensity *= .92;
        }

        ctx.clearRect(-20, -20, width + 40, height + 40);

        if (state !== 'MENU') {
            ctx.strokeStyle = THEME.GRID; ctx.lineWidth = 1;
            for (let col = 0; col <= BLOCK_COLS; col++) { ctx.beginPath(); ctx.moveTo(col * BLOCK_SIZE, TOP_OFFSET); ctx.lineTo(col * BLOCK_SIZE, FIRE_ZONE_Y); ctx.stroke(); }
            ctx.beginPath(); ctx.moveTo(0, FIRE_ZONE_Y); ctx.lineTo(width, FIRE_ZONE_Y);
            ctx.strokeStyle = dangerFlash > 0 ? 'rgba(255,40,40,.9)' : 'rgba(255,80,80,.48)'; ctx.lineWidth = dangerFlash > 0 ? 5 : 3;
            ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
            
            blocks.forEach(block => block.draw());
            items.forEach(item => item.draw());
            balls.forEach(ball => ball.draw());
            particles.forEach(p => p.draw());
            floatingTexts.forEach(t => t.draw());

            // HUD
            ctx.fillStyle = 'rgba(255,255,255,.54)'; ctx.beginPath(); ctx.roundRect(12, 12, width - 24, 48, 15); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = THEME.TEXT_MAIN; ctx.font = '800 10px "Inter"'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.fillText(`SCORE ${score}`, 24, 30); ctx.fillText(`BALLEN ${baseTotalBalls}`, 24, 47);
            ctx.textAlign = 'center'; ctx.fillText(`COMBO ${comboCount}`, width / 2, 30);
            ctx.fillStyle = shieldCharges > 0 ? THEME.ACCENT_PURPLE : 'rgba(44,62,80,.5)';
            ctx.fillText(`SCHILD ${'◇'.repeat(shieldCharges)}${shieldCharges === 0 ? '0' : ''}`, width / 2, 47);
            ctx.fillStyle = THEME.TEXT_MAIN; ctx.textAlign = 'right';
            ctx.fillText(`WAVE ${wave}`, width - 24, 30); ctx.fillText(wave % 5 === 0 ? 'CHALLENGE' : `BEST ${highScore}`, width - 24, 47);

            if (state === 'AIMING') {
                ctx.beginPath(); ctx.arc(startX, startY, BALL_RADIUS + 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.94)';
                ctx.strokeStyle = 'rgba(58,134,255,.42)'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
                ctx.fillStyle = THEME.TEXT_MAIN; ctx.font = '800 11px "Inter"'; ctx.textAlign = 'center'; ctx.fillText(`x${baseTotalBalls}`, startX, startY + 24);
                drawAimGuide(isDragging ? clamp(Math.atan2(mouseY - startY, mouseX - startX), -Math.PI + .12, -.12) : keyboardAngle);
            }

            if (bannerLife > 0) {
                const y = 78 + Math.sin((115 - bannerLife) * .04) * 2;
                ctx.globalAlpha = Math.min(clamp((115 - bannerLife) / 12, 0, 1), clamp(bannerLife / 18, 0, 1));
                ctx.fillStyle = 'rgba(255,255,255,.76)'; ctx.beginPath(); ctx.roundRect(30, y, width - 60, 54, 16); ctx.fill();
                ctx.fillStyle = wave % 5 === 0 ? THEME.ACCENT_PINK : THEME.ACCENT_BLUE; ctx.font = 'bold 12px "Press Start 2P"'; ctx.textAlign = 'center';
                ctx.fillText(bannerText, width / 2, y + 21); ctx.fillStyle = '#475569'; ctx.font = '700 9px "Inter"'; ctx.fillText(bannerSubtext, width / 2, y + 40);
                ctx.globalAlpha = 1;
            }
        }
        ctx.restore();

        if (state !== 'PAUSED' && state !== 'MENU' && state !== 'GAMEOVER') {
            items.forEach(item => item.update(dt));
            if (state === 'SHOOTING' || state === 'WAITING') balls.forEach(ball => ball.update(dt));
            
            for (let index = particles.length - 1; index >= 0; index--) { particles[index].update(dt); if (particles[index].life <= 0) particles.splice(index, 1); }
            for (let index = floatingTexts.length - 1; index >= 0; index--) { floatingTexts[index].update(dt); if (floatingTexts[index].life <= 0) floatingTexts.splice(index, 1); }
            if (bannerLife > 0) bannerLife -= dt/16.66;
            if (dangerFlash > 0) dangerFlash -= dt/16.66;
        }

        requestAnimationFrame(gameLoop);
    }

    menuHighScore.textContent = String(highScore);
    resizeGame(true);
    requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(gameLoop); });
})();
