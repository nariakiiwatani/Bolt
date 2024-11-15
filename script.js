class WaveSurferManager {
    static createWaveSurfer(container, channels = 1) {
        console.log('Creating WaveSurfer with channels:', channels);

        const height = channels === 1 ? 80 : 160;
        container.style.height = `${height}px`;

        return WaveSurfer.create({
            container: container,
			mediaContainer: container,
            waveColor: channels > 1 ? ['#4F4F4F', '#4F4F4F'] : '#4F4F4F',
            progressColor: channels > 1 ? ['#383838', '#383838'] : '#383838',
            height: height,
            normalize: false,
            splitChannels: true,
            maxCanvasWidth: 4000,
            minPxPerSec: 50,
            cursorWidth: 1,
            backend: 'WebAudio',
            responsive: true,
            fillParent: true,
            scrollParent: false,
            pixelRatio: 1,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
        });
    }

    static async loadAudioData(wavesurfer, audioData) {
        return new Promise((resolve, reject) => {
            wavesurfer.on('ready', () => {
                const channels = wavesurfer.backend.buffer.numberOfChannels;
                resolve(channels);
            });

            wavesurfer.on('error', (error) => {
                console.error('WaveSurfer error:', error);
                reject(error);
            });

            try {
                if (audioData instanceof Blob) {
                    wavesurfer.loadBlob(audioData);
                } else if (audioData instanceof AudioBuffer) {
                    wavesurfer.loadDecodedBuffer(audioData);
                } else {
                    throw new Error('Unsupported audio data type');
                }
            } catch (error) {
                console.error('Error loading audio data:', error);
                reject(error);
            }
        });
    }
}

class AudioTrack {
    constructor(label, onLoadComplete, options = {}) {
        this.file = null;
        this.label = label;
        this.wavesurfer = null;
        this.onLoadComplete = onLoadComplete;
        this.options = options;
        this.element = this.createElements();
        this.isLoaded = false;
    }

    createElements() {
        const template = document.getElementById('track-template');
        const element = template.content.cloneNode(true).firstElementChild;
        
        // ファイル選択関連の要素を作成
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';

        // ファイル選択エリアのスタイルを強化
        const dropArea = document.createElement('div');
        dropArea.className = 'file-drop-area';
        
        const fileButton = document.createElement('button');
        fileButton.textContent = 'ファイルを選択';
        fileButton.onclick = () => fileInput.click();

        const fileLabel = document.createElement('span');
        fileLabel.textContent = 'ファイルが選択されていません';
        fileLabel.className = 'file-label';

        const dropText = document.createElement('div');
        dropText.textContent = 'またはファイルをドロップ';
        dropText.className = 'drop-text';

		const audioInfo = document.createElement('div');
        audioInfo.className = 'audio-info';

        // ドラッグ&ドロップイベントの設定
        const handleDragOver = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.classList.add('dragover');
        };

        const handleDragLeave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.classList.remove('dragover');
        };

        const handleDrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('audio/')) {
                this.file = files[0];
                fileLabel.textContent = this.file.name;
                
                if (this.wavesurfer) {
                    this.wavesurfer.destroy();
                }
                
                await this.setupWaveSurfer();

                if (this.onLoadComplete) {
                    this.onLoadComplete();
                }
            }
        };

        dropArea.addEventListener('dragover', handleDragOver);
        dropArea.addEventListener('dragleave', handleDragLeave);
        dropArea.addEventListener('drop', handleDrop);

        // 要素の配置
        dropArea.appendChild(fileButton);
        dropArea.appendChild(fileLabel);
        dropArea.appendChild(dropText);
        dropArea.appendChild(fileInput);

        const fileControls = document.createElement('div');
        fileControls.className = 'file-controls';
        fileControls.appendChild(dropArea);
        fileControls.appendChild(audioInfo);

        // ラベルを作成して最初に追加
        const labelDiv = document.createElement('div');
        labelDiv.className = 'track-label';
        labelDiv.textContent = this.label;
        element.insertBefore(labelDiv, element.firstChild);

        // ファイルコントロールをラベルの後に追加
        element.insertBefore(fileControls, labelDiv.nextSibling);

        fileInput.addEventListener('change', async (e) => {
            if (e.target.files[0]) {
                this.file = e.target.files[0];
                fileLabel.textContent = this.file.name;
                
                if (this.wavesurfer) {
                    this.wavesurfer.destroy();
                }
                
                await this.setupWaveSurfer();

                if (this.onLoadComplete) {
                    this.onLoadComplete();
                }
            }
        });

        this.waveformElement = element.querySelector('.waveform');
        
        // 音量コントロールの修正
        const volumeControl = element.querySelector('.volume-control');
        volumeControl.innerHTML = ''; // 既存の内容をクリア
        
        const volumeLabel = document.createElement('label');
        volumeLabel.textContent = '音量:';
        
        const volumeInput = document.createElement('input');
        volumeInput.type = 'number';
        volumeInput.min = '-60';
        volumeInput.max = '12';
        volumeInput.step = '1';
        volumeInput.value = '0';
        volumeInput.style.width = '60px';
        
        const dbLabel = document.createElement('span');
        dbLabel.textContent = 'dB';
        
        volumeControl.appendChild(volumeLabel);
        volumeControl.appendChild(volumeInput);
        volumeControl.appendChild(dbLabel);
        
        this.volumeControl = volumeInput;
        
        // イベントリスナーの修正
        this.volumeControl.addEventListener('input', () => {
            const dbValue = Number(this.volumeControl.value);
            if (this.wavesurfer) {
                // dBから倍率への変換
                const gain = this.dbToGain(dbValue);
                this.wavesurfer.setVolume(gain);
            }
        });

        this.playButton = element.querySelector('.play');
        this.stopButton = element.querySelector('.stop');

        this.playButton.textContent = '再生';
        this.playButton.disabled = true;
        this.stopButton.disabled = true;

        this.isPlaying = false;

        this.playButton.addEventListener('click', () => {
            if (this.wavesurfer) {
                if (this.isPlaying) {
                    this.wavesurfer.pause();
                } else {
                    this.wavesurfer.play();
                }
            }
        });

        this.stopButton.addEventListener('click', () => {
            if (this.wavesurfer) {
                this.wavesurfer.stop();
                this.updatePlayButtonState(false);
            }
        });

        // BGMトラックの場合のみエンベロープエディタを追加
        if (this.label === 'BGM') {
            const envelopeContainer = document.createElement('div');
            envelopeContainer.className = 'envelope-editor';
            
            const header = document.createElement('div');
            header.className = 'envelope-header';
            header.innerHTML = `
                <div class="envelope-title">
                    <span class="toggle-icon">▶</span>
                    <h3>BGMエンベロープ</h3>
                </div>
            `;
            
            const controls = document.createElement('div');
            controls.className = 'envelope-controls';
            controls.style.display = 'none';
            controls.innerHTML = `
                <div class="trapezoid-editor">
                    <h4>開始部分</h4>
                    <div class="time-controls">
                        <div class="control-group">
                            <label>FadeIn (秒):</label>
                            <input type="number" id="start-fadein" value="0.1" step="0.1" min="0.1" max="5.0">
                        </div>
                        <div class="control-group">
                            <label>Sustain (秒):</label>
                            <input type="number" id="start-sustain" value="2.0" step="0.1" min="0.1" max="5.0">
                        </div>
                        <div class="control-group">
                            <label>FadeOut (秒):</label>
                            <input type="number" id="start-fadeout" value="3.0" step="0.1" min="0.1" max="5.0">
                        </div>
                    </div>
                    <canvas id="envelope-start" width="240" height="160"></canvas>
                </div>

                <div class="common-controls">
                    <div class="db-controls">
                        <div class="control-group">
                            <label>Max (dB):</label>
                            <input type="number" id="envelope-max" value="0" step="1" min="-60" max="12">
                        </div>
                        <div class="control-group">
                            <label>Min (dB):</label>
                            <input type="number" id="envelope-min" value="-24" step="1" min="-60" max="0">
                        </div>
                    </div>
                </div>

                <div class="trapezoid-editor">
                    <h4>終了部分</h4>
                    <div class="time-controls">
                        <div class="control-group">
                            <label>FadeIn (秒):</label>
                            <input type="number" id="end-fadein" value="0.5" step="0.1" min="0.1" max="5.0">
                        </div>
                        <div class="control-group">
                            <label>Sustain (秒):</label>
                            <input type="number" id="end-sustain" value="2.0" step="0.1" min="0.1" max="5.0">
                        </div>
                        <div class="control-group">
                            <label>FadeOut (秒):</label>
                            <input type="number" id="end-fadeout" value="0.5" step="0.1" min="0.1" max="5.0">
                        </div>
                    </div>
                    <canvas id="envelope-end" width="240" height="160"></canvas>
                </div>
            `;

            // 折りたたみ機能の実装
            header.addEventListener('click', () => {
                controls.style.display = controls.style.display === 'none' ? 'flex' : 'none';
                header.querySelector('.toggle-icon').textContent = 
                    controls.style.display === 'none' ? '▶' : '▼';
            });

            envelopeContainer.appendChild(header);
            envelopeContainer.appendChild(controls);
            element.appendChild(envelopeContainer);

            // エンベロープエディタ固有のスタイルのみ追加
            const envelopeStyle = document.createElement('style');
            envelopeStyle.textContent = `
                .envelope-header {
                    cursor: pointer;
                    user-select: none;
                    padding: 10px;
                    background: #f5f5f5;
                    border-radius: 4px;
                    margin-bottom: 10px;
                }
                
                .envelope-title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 0;
                }
                
                .envelope-title h3 {
                    margin: 0;
                }
                
                .toggle-icon {
                    font-family: monospace;
                    font-size: 12px;
                }
                
                .envelope-header:hover {
                    background: #e8e8e8;
                }
            `;
            document.head.appendChild(envelopeStyle);

            // DOMの追加後に初期化を実行
            requestAnimationFrame(() => {
                if (this.options.onEnvelopeChange) {
                    this.envelopeEditor = new EnvelopeEditor(this.options.onEnvelopeChange);
                }
            });
        }
        
        const style = document.createElement('style');
        style.textContent = `
            .audio-info {
                margin-top: 8px;
                font-size: 0.9em;
                color: #666;
            }
            .audio-info.error {
                color: #d32f2f;
            }
            .audio-info-table {
                display: grid;
                grid-template-columns: auto auto;
                gap: 4px 12px;
                margin-top: 4px;
            }
            .audio-info-label {
                color: #888;
            }
        `;
        document.head.appendChild(style);

        this.audioInfo = audioInfo;
        this.fileLabel = fileLabel;

        return element;
    }

    async setupWaveSurfer() {
        try {
            const container = this.waveformElement;
            const audioData = this.file;

            if (this.wavesurfer) {
                this.wavesurfer.destroy();
            }

            this.isLoaded = false;
            
            // まずデフォルトの設定で作成
            this.wavesurfer = WaveSurferManager.createWaveSurfer(container);
            
            // オーディオデータを読み込��でチャンネル数を���得
            const channels = await WaveSurferManager.loadAudioData(this.wavesurfer, audioData);
            
            // ステレオの場合は再作成
            if (channels > 1) {
                this.wavesurfer.destroy();
                this.wavesurfer = WaveSurferManager.createWaveSurfer(container, channels);
                await WaveSurferManager.loadAudioData(this.wavesurfer, audioData);
            }

            this.isLoaded = true;
            this.updatePlayButtonState(false);
            this.playButton.disabled = false;
            this.stopButton.disabled = false;

            // 読み込み前に情報表示をクリア
            this.audioInfo.innerHTML = '読み込み中...';
            
            // WaveSurferのイベントリスナーを設定
            this.wavesurfer.on('play', () => {
                this.updatePlayButtonState(true);
            });

            this.wavesurfer.on('pause', () => {
                this.updatePlayButtonState(false);
            });

            this.wavesurfer.on('finish', () => {
                this.updatePlayButtonState(false);
            });
            
            await WaveSurferManager.loadAudioData(this.wavesurfer, audioData);
            
            // 音声情報の表示を更新
            const audioBuffer = this.wavesurfer.backend.buffer;
            this.updateAudioInfo(audioBuffer);

            this.isLoaded = true;
            if (this.onLoadComplete) {
                this.onLoadComplete();
            }

            // 再生コントロールを有効化
            this.playButton.disabled = false;
            this.stopButton.disabled = false;

        } catch (err) {
            console.error('Error in setupWaveSurfer:', err);
            this.isLoaded = false;
            this.showError(err);
            
            // エラーはボタンを無効化
            this.playButton.disabled = true;
            this.stopButton.disabled = true;
            
            if (this.onLoadComplete) {
                this.onLoadComplete();
            }
        }
    }

    updateAudioInfo(audioBuffer) {
        const duration = audioBuffer.duration;
        const sampleRate = audioBuffer.sampleRate;
        const channels = audioBuffer.numberOfChannels;
        
        // ビットレートの推定（WebAudioAPIでは直接取得できないため）
        const bitrate = Math.round(
            (audioBuffer.length * audioBuffer.numberOfChannels * 16) / // 16 bits per sample
            (audioBuffer.duration * 1000)
        );

        this.audioInfo.className = 'audio-info';
        this.audioInfo.innerHTML = `
            <div class="audio-info-table">
                <span class="audio-info-label">長さ:</span>
                <span>${this.formatTime(duration)}</span>
                
                <span class="audio-info-label">サンプリングレート:</span>
                <span>${sampleRate.toLocaleString()} Hz</span>
                
                <span class="audio-info-label">推定ビットレート:</span>
                <span>${bitrate} kbps</span>
                
                <span class="audio-info-label">チャンネル数:</span>
                <span>${channels === 1 ? 'モノラル' : 'ステレオ'}</span>
            </div>
        `;
    }

    showError(error) {
        this.audioInfo.className = 'audio-info error';
        this.audioInfo.textContent = `エラー: ${error.message || '音声ファイルの読み込みに失敗しました'}`;
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }

    getEnvelopeData() {
        return [{time: 0, value: 1}, {time: 1, value: 1}];
    }

    getAudioBuffer() {
        if (!this.wavesurfer || !this.wavesurfer.backend.buffer) {
            throw new Error('音声データが読み込れいませ');
        }
        return this.wavesurfer.backend.buffer;
    }

    getVolume() {
        return this.dbToGain(Number(this.volumeControl.value));
    }

    destroy() {
        if (this.wavesurfer) {
            this.wavesurfer.destroy();
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    // dBから倍率への変換メソッドを追加
    dbToGain(db) {
        if (db <= -60) return 0;
        return Math.pow(10, db / 20);
    }

    // 再生ボタンの状態を更新するメソッドを追加
    updatePlayButtonState(isPlaying) {
        this.isPlaying = isPlaying;
        this.playButton.textContent = isPlaying ? '一時停止' : '再生';
    }

    // ファイルが正常に読み込まれているかを確認するメソッド
    isFileLoaded() {
        return this.isLoaded && this.wavesurfer !== null && this.file !== null;
    }
}

class AudioMixer {
    constructor() {
        this.audioContext = null;
        this.mainTrack = new AudioTrack('メイン', () => this.updateMixButtonState());
        
        // エンベロープの初期値を設定
        this.envelope = {
            fadeInTime1: 0.1,
            sustainTime1: 2.0,
            fadeOutTime1: 3.0,
            fadeInTime2: 0.5,
            sustainTime2: 2.0,
            fadeOutTime2: 0.5,
            maxDb: 0,
            minDb: -24
        };
        
        this.bgmTrack = new AudioTrack('BGM', 
            () => this.updateMixButtonState(),
            { 
                onEnvelopeChange: (envelope) => this.updateEnvelope(envelope) 
            }
        );
        this.mixedBuffer = null;
        this.previewWaveSurfer = null;
        this.mixButton = null;
        this.downloadButton = null;
    }

    initialize() {
        const container = document.createElement('div');
        container.className = 'mixer-container';
        document.body.appendChild(container);

        // メイントラックのコンテナ
        const mainTrackContainer = document.createElement('div');
        mainTrackContainer.id = 'main-track-container';
        container.appendChild(mainTrackContainer);
        mainTrackContainer.appendChild(this.mainTrack.element);

        // BGMトラックのコンテナ
        const bgmTrackContainer = document.createElement('div');
        bgmTrackContainer.id = 'bgm-track-container';
        container.appendChild(bgmTrackContainer);
        bgmTrackContainer.appendChild(this.bgmTrack.element);

        // プレビュセクションを作成
        const previewSection = document.createElement('div');
        previewSection.className = 'preview-section';
        container.appendChild(previewSection);

        // プレビューのタイトル
        const previewTitle = document.createElement('div');
        previewTitle.className = 'preview-title';
        previewTitle.textContent = '合成結果';
        previewSection.appendChild(previewTitle);

		// 合成・ダウンロードボタンのコンテナ
		const actionControls = document.createElement('div');
		actionControls.className = 'action-controls';
		previewSection.appendChild(actionControls);

		// 合成ボタン
		this.mixButton = document.createElement('button');
		this.mixButton.id = 'mix-button';
		this.mixButton.textContent = '合成';
		this.mixButton.disabled = true;
		this.mixButton.onclick = () => this.mixTracks();
		actionControls.appendChild(this.mixButton);

		// ダウンロードボタン
		this.downloadButton = document.createElement('button');
		this.downloadButton.id = 'download-button';
		this.downloadButton.textContent = 'ダウンロード';
		this.downloadButton.disabled = true;
		this.downloadButton.onclick = () => this.downloadMix();
		actionControls.appendChild(this.downloadButton);

		// チャンネル設定のコントロールを追加
		const channelControl = document.createElement('div');
		channelControl.className = 'channel-control';
		
		const channelLabel = document.createElement('span');
		channelLabel.textContent = '出力チャンネル: ';
		channelControl.appendChild(channelLabel);

		this.channelSelect = document.createElement('select');
		this.channelSelect.innerHTML = `
			<option value="auto">自動 (入力に従う)</option>
			<option value="mono">ノラル (1ch)</option>
			<option value="stereo">ステレオ (2ch)</option>
		`;
		channelControl.appendChild(this.channelSelect);

		// 合成ボタンの前に配置
		actionControls.insertBefore(channelControl, this.mixButton);
		
        // プレビュー波形表示用の要素
        const previewWaveform = document.createElement('div');
        previewWaveform.id = 'preview-waveform';
        previewSection.appendChild(previewWaveform);

        // プレビュー用の再生コントロール
        const playbackControls = document.createElement('div');
        playbackControls.className = 'playback-controls';
        previewSection.appendChild(playbackControls);

        // 再生/一時停止ボタン
        this.previewPlayButton = document.createElement('button');
        this.previewPlayButton.className = 'preview-play';
        this.previewPlayButton.textContent = '再生';
        this.previewPlayButton.disabled = true;
        this.previewPlayButton.onclick = () => {
            if (this.previewWaveSurfer.isPlaying()) {
                this.previewWaveSurfer.pause();
            } else {
                this.previewWaveSurfer.play();
            }
        };
        playbackControls.appendChild(this.previewPlayButton);

        // 停止ボタン
        this.previewStopButton = document.createElement('button');
        this.previewStopButton.className = 'preview-stop';
        this.previewStopButton.textContent = '停止';
        this.previewStopButton.disabled = true;
        this.previewStopButton.onclick = () => {
            this.previewWaveSurfer.stop();
            this.updatePreviewPlayButtonState(false);
        };
        playbackControls.appendChild(this.previewStopButton);

        // スタイルの追加
        const style = document.createElement('style');
        style.textContent = `
            .preview-section {
                margin: 20px 0;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 5px;
                background: #fff;
            }

            .preview-title {
                font-size: 1.2em;
                font-weight: bold;
                margin-bottom: 15px;
                color: #333;
            }

            #preview-waveform {
                margin: 15px 0;
                background: #f5f5f5;
                border-radius: 4px;
                min-height: 100px;
            }

            .playback-controls {
                display: flex;
                gap: 10px;
                margin: 15px 0;
                justify-content: center;
            }

            .action-controls {
                display: flex;
                gap: 10px;
                margin-top: 15px;
                justify-content: center;
                border-top: 1px solid #eee;
                padding-top: 15px;
            }

            .preview-section button {
                padding: 8px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1em;
            }

            .playback-controls button {
                background: #4CAF50;
                color: white;
            }

            .action-controls button {
                background: #2196F3;
                color: white;
            }

            .preview-section button:disabled {
                background: #ccc;
                cursor: not-allowed;
            }

            .preview-section button:hover:not(:disabled) {
                opacity: 0.9;
            }

            .channel-control {
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 10px;
                justify-content: center;
            }
            
            .channel-control select {
                padding: 4px 8px;
                border-radius: 4px;
                border: 1px solid #ccc;
            }
        `;
        document.head.appendChild(style);

        // プレビュー用のWaveSurferを初化
        this.previewWaveSurfer = WaveSurferManager.createWaveSurfer(
            previewWaveform,
            2  // ステレオ表示用に2チャンネル指定
        );

        // プビューWaveSurferのイントリスナー
        this.previewWaveSurfer.on('play', () => {
            this.updatePreviewPlayButtonState(true);
        });

        this.previewWaveSurfer.on('pause', () => {
            this.updatePreviewPlayButtonState(false);
        });

        this.previewWaveSurfer.on('finish', () => {
            this.updatePreviewPlayButtonState(false);
        });
    }

    // プレビュー再生ボタンの状態を更新
    updatePreviewPlayButtonState(isPlaying) {
        if (this.previewPlayButton) {
            this.previewPlayButton.textContent = isPlaying ? '一時停止' : '再生';
        }
    }

    // mixTracksメソッドも更新
    async mixTracks() {
        try {
            if (!this.audioContext) {
                this.audioContext = new AudioContext();
            }

            const mainBuffer = this.mainTrack.wavesurfer.backend.buffer;
            const bgmBuffer = this.bgmTrack.wavesurfer.backend.buffer;

            // サンプリングレートの確認とログ出力
            console.log('Sampling rates:', {
                main: mainBuffer.sampleRate,
                bgm: bgmBuffer.sampleRate,
                context: this.audioContext.sampleRate
            });

            // サンリングレートが異なる場合は変換
            let normalizedMainBuffer = mainBuffer;
            let normalizedBgmBuffer = bgmBuffer;

            if (mainBuffer.sampleRate !== this.audioContext.sampleRate) {
                normalizedMainBuffer = await this.resampleBuffer(mainBuffer, this.audioContext.sampleRate);
            }
            if (bgmBuffer.sampleRate !== this.audioContext.sampleRate) {
                normalizedBgmBuffer = await this.resampleBuffer(bgmBuffer, this.audioContext.sampleRate);
            }

            // エンベロープの合計時間を計算
            const {
                fadeInTime1, sustainTime1, fadeOutTime1,
                fadeInTime2, sustainTime2, fadeOutTime2
            } = this.envelope;
            
            const startEnvelopeDuration = fadeInTime1 + sustainTime1 + fadeOutTime1;
            const endEnvelopeDuration = fadeInTime2 + sustainTime2 + fadeOutTime2;
            
            // メイン音声の長さにエンベロープの長さを加えた合計を計算
            const totalDuration = normalizedMainBuffer.duration + startEnvelopeDuration + endEnvelopeDuration;
            
            // サンプル数に変換
            const outputLength = Math.ceil(totalDuration * this.audioContext.sampleRate);

            console.log('Output buffer calculation:', {
                mainDuration: normalizedMainBuffer.duration,
                startEnvelope: startEnvelopeDuration,
                endEnvelope: endEnvelopeDuration,
                totalDuration: totalDuration,
                sampleRate: this.audioContext.sampleRate,
                outputLength: outputLength
            });

            // チャンネル数の決定
            let outputChannels;
            switch (this.channelSelect.value) {
                case 'mono':
                    outputChannels = 1;
                    break;
                case 'stereo':
                    outputChannels = 2;
                    break;
                default: // 'auto'
                    outputChannels = Math.max(
                        normalizedMainBuffer.numberOfChannels,
                        normalizedBgmBuffer.numberOfChannels
                    );
            }

            // 出力バッファの作成
            const outputBuffer = this.audioContext.createBuffer(
                outputChannels,
                outputLength,
                this.audioContext.sampleRate
            );


			const startEnvelopeSamples = Math.ceil(startEnvelopeDuration * this.audioContext.sampleRate);
			// メイン音声の音量を取得（dBから倍率に変換）
            const mainVolume = this.mainTrack.getVolume();
            // BGM音声の音量を取得（dBから倍率に変換）
            const bgmVolume = this.bgmTrack.getVolume();

            // 各チャンネルのミキシング
            for (let channel = 0; channel < outputChannels; channel++) {
                const outputData = outputBuffer.getChannelData(channel);
                
                // 入力チャンネルのマッピング
                let mainData, bgmData;
                
                if (outputChannels === 1) {
                    // モノラル出力の場合は全チャンネルを平均化
                    mainData = this.averageChannels(normalizedMainBuffer);
                    bgmData = this.averageChannels(normalizedBgmBuffer);
                } else {
                    // ステレオ出力の場合
                    mainData = channel < normalizedMainBuffer.numberOfChannels ? 
                        normalizedMainBuffer.getChannelData(channel) : 
                        normalizedMainBuffer.getChannelData(0);
                    bgmData = channel < normalizedBgmBuffer.numberOfChannels ? 
                        normalizedBgmBuffer.getChannelData(channel) : 
                        normalizedBgmBuffer.getChannelData(0);
                }

                // エンベロープの適用とミキシング
                for (let i = 0; i < outputLength; i++) {
                    const time = i / this.audioContext.sampleRate;
                    const envelopeGain = this.calculateEnvelopeGain(time, totalDuration);
                    
                    // メイン音声のインデックスをエンベロープ開始分ずらす
					const mainIndex = i - startEnvelopeSamples;
					const mainSample = (mainIndex >= 0 && mainIndex < mainData.length) ? 
						mainData[mainIndex] * mainVolume : 
						0;
					
					// BGMのインデックス（ループ処理を含む）
					const bgmIndex = i % bgmData.length;
					const bgmSample = bgmData[bgmIndex] * envelopeGain * bgmVolume;
					
					// 両者を合成
					outputData[i] = mainSample + bgmSample;
                }
            }

            // デバッグ用のログ
            console.log('Mixed buffer created:', {
                duration: outputBuffer.duration,
                numberOfChannels: outputBuffer.numberOfChannels,
                sampleRate: outputBuffer.sampleRate
            });

            // プレビュー用のWaveSurferを新
            if (this.previewWaveSurfer) {
                await this.previewWaveSurfer.loadDecodedBuffer(outputBuffer);
                // 再生コントロールを有効化
                this.previewPlayButton.disabled = false;
                this.previewStopButton.disabled = false;
            }

            this.mixedBuffer = outputBuffer;
            this.downloadButton.disabled = false;

        } catch (error) {
            console.error('Mixing error:', error);
            this.downloadButton.disabled = true;
            this.previewPlayButton.disabled = true;
            this.previewStopButton.disabled = true;
            throw error;
        }
    }

    calculateEnvelopeGain(time, totalDuration) {
        const {
            fadeInTime1, sustainTime1, fadeOutTime1,
            fadeInTime2, sustainTime2, fadeOutTime2,
            maxDb, minDb
        } = this.envelope;

        // dBから倍率への変換
        const maxGain = Math.pow(10, maxDb / 20);
        const minGain = Math.pow(10, minDb / 20);

        // 開始部分のエンベロープ
        if (time < fadeInTime1) {
            return minGain + (maxGain - minGain) * (time / fadeInTime1);
        }
        if (time < fadeInTime1 + sustainTime1) {
            return maxGain;
        }
        if (time < fadeInTime1 + sustainTime1 + fadeOutTime1) {
            const t = (time - fadeInTime1 - sustainTime1) / fadeOutTime1;
            return maxGain + (minGain - maxGain) * t;
        }

        // 終了部分のエンベロープ
        const endTime = totalDuration - (fadeInTime2 + sustainTime2 + fadeOutTime2);
        if (time > endTime) {
            if (time < endTime + fadeInTime2) {
                const t = (time - endTime) / fadeInTime2;
                return minGain + (maxGain - minGain) * t;
            }
            if (time < endTime + fadeInTime2 + sustainTime2) {
                return maxGain;
            }
            if (time < endTime + fadeInTime2 + sustainTime2 + fadeOutTime2) {
                const t = (time - endTime - fadeInTime2 - sustainTime2) / fadeOutTime2;
                return maxGain + (minGain - maxGain) * t;
            }
        }

        // それ以外の部分
        return minGain;
    }

    getMinValue(array) {
        let min = 0;
        for (let i = 0; i < array.length; i++) {
            if (array[i] < min) min = array[i];
        }
        return min;
    }

    normalizeBuffer(buffer) {
        let maxAmp = 0;
        let minAmp = 0;
        
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) {
                maxAmp = Math.max(maxAmp, data[i]);
                minAmp = Math.min(minAmp, data[i]);
            }
        }

        const absMax = Math.max(Math.abs(maxAmp), Math.abs(minAmp));

        if (absMax > 1) {
            const scale = 0.99 / absMax;
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let i = 0; i < data.length; i++) {
                    data[i] *= scale;
                }
            }
        }
    }

    async downloadMix() {
        if (!this.mixedBuffer) return;

        const blob = await this.audioBufferToBlob(this.mixedBuffer);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mixed_audio.wav';
        a.click();
        URL.revokeObjectURL(url);
    }

    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const wav = new ArrayBuffer(44 + buffer.length * blockAlign);
        const view = new DataView(wav);
        
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + buffer.length * blockAlign, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, buffer.length * blockAlign, true);

        const offset = 44;
        const samples = new Float32Array(buffer.length * numChannels);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            for (let i = 0; i < buffer.length; i++) {
                samples[i * numChannels + channel] = channelData[i];
            }
        }

        for (let i = 0; i < samples.length; i++) {
            const sample = Math.max(-1, Math.min(1, samples[i]));
            const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset + i * bytesPerSample, value, true);
        }

        return wav;
    }

    async audioBufferToBlob(audioBuffer) {
        const wav = this.audioBufferToWav(audioBuffer);
        return new Blob([wav], { type: 'audio/wav' });
    }

    async getAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.audioContext.resume();
        }
        return this.audioContext;
    }

    updateMixButtonState() {
        // ボタンの参照を使用
        if (this.mixButton) {
            this.mixButton.disabled = !(this.mainTrack.isFileLoaded() && this.bgmTrack.isFileLoaded());
        }
    }

    updateEnvelope(newEnvelope) {
        this.envelope = {
            ...this.envelope,
            ...newEnvelope
        };
    }

    // サンプリングレート変換用のメソッド
    async resampleBuffer(buffer, targetSampleRate) {
        const offlineCtx = new OfflineAudioContext(
            buffer.numberOfChannels,
            buffer.duration * targetSampleRate,
            targetSampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start();

        try {
            const renderedBuffer = await offlineCtx.startRendering();
            console.log('Resampling completed:', {
                originalRate: buffer.sampleRate,
                newRate: renderedBuffer.sampleRate,
                originalDuration: buffer.duration,
                newDuration: renderedBuffer.duration
            });
            return renderedBuffer;
        } catch (error) {
            console.error('Resampling failed:', error);
            throw error;
        }
    }

    // チャンネルの平均化を行うヘルパーメソッド
    averageChannels(buffer) {
        const length = buffer.length;
        const averaged = new Float32Array(length);
        
        for (let i = 0; i < length; i++) {
            let sum = 0;
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                sum += buffer.getChannelData(channel)[i];
            }
            averaged[i] = sum / buffer.numberOfChannels;
        }
        
        return averaged;
    }
}

class TrapezoidEditor {
    constructor(canvasId, params) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.params = params;
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // グリッドを描画
        this.drawGrid();

        // 台形を描画
        this.drawTrapezoid();
    }

    drawTrapezoid() {
        const ctx = this.ctx;
        const points = this.calculatePoints();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    updateParams(params) {
        this.params = { ...this.params, ...params };
        this.draw();
    }

    calculateTimeScale() {
        const { fadeTime, sustainTime, fadeOutTime } = this.params;
        return fadeTime + sustainTime + fadeOutTime;
    }

    timeToX(time) {
        const totalTime = this.calculateTimeScale();
        return (time * this.canvas.width) / totalTime;
    }

    dbToY(db) {
        if (db === -Infinity) {
            return this.canvas.height;
        }
        return -db * (this.canvas.height / 60);
    }

    drawGrid() {
        const ctx = this.ctx;
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;

        const totalTime = this.calculateTimeScale();
        const gridInterval = this.calculateGridInterval(totalTime);

        // グリッドの描画（0秒ら合計時間まで）
        for (let i = 0; i <= totalTime; i += gridInterval) {
            const x = this.timeToX(i);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
            ctx.stroke();

            // 秒数のラベル
            ctx.fillStyle = '#666';
            ctx.fillText(`${i}s`, x, this.canvas.height - 5);
        }

        // dBのグリッド
        for (let db = 0; db >= -60; db -= 12) {
            const y = this.dbToY(db);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
            ctx.stroke();
            ctx.fillStyle = '#666';
            ctx.fillText(`${db}dB`, 5, y - 5);
        }
    }

    calculateGridInterval(totalTime) {
        if (totalTime <= 1) return 0.2;      // 1秒以下なら0.2秒間隔
        if (totalTime <= 2) return 0.5;      // 2秒以下なら0.5間隔
        if (totalTime <= 5) return 1.0;      // 5秒以下なら1秒間隔
        if (totalTime <= 10) return 2.0;     // 10秒以下なら2秒間隔
        return Math.ceil(totalTime / 5);     // それ以上は5分割程度
    }

    calculatePoints() {
        const { fadeTime, sustainTime, fadeOutTime, maxDb, minDb } = this.params;
        const isStartTrapezoid = this.canvas.id === 'envelope-start';

        return [
            // 1点目は常にCanvas左端
            { x: 0, 
              y: isStartTrapezoid ? this.canvas.height : this.dbToY(minDb) },
            // 中間点は時間に応じて配置
            { x: this.timeToX(fadeTime), 
              y: this.dbToY(maxDb) },
            { x: this.timeToX(fadeTime + sustainTime), 
              y: this.dbToY(maxDb) },
            // 4点目は常Canvas右端
            { x: this.canvas.width, 
              y: isStartTrapezoid ? this.dbToY(minDb) : this.canvas.height }
        ];
    }
}

class EnvelopeEditor {
    constructor(onChange) {
        this.onChange = onChange;

        // localStorageから設定を読み込む
        this.loadSettings();

        // エディターの初期化
        this.startEditor = new TrapezoidEditor('envelope-start', {
            fadeTime: this.settings.fadeInTime1,
            sustainTime: this.settings.sustainTime1,
            fadeOutTime: this.settings.fadeOutTime1,
            maxDb: this.settings.maxDb,
            minDb: this.settings.minDb
        });

        this.endEditor = new TrapezoidEditor('envelope-end', {
            fadeTime: this.settings.fadeInTime2,
            sustainTime: this.settings.sustainTime2,
            fadeOutTime: this.settings.fadeOutTime2,
            maxDb: this.settings.maxDb,
            minDb: this.settings.minDb
        });

        // maxDb、minDbの初期値��設定
        this.maxDb = this.settings.maxDb;
        this.minDb = this.settings.minDb;

        // UIの値を更新
        this.updateUIValues();
        
        // イベントリスナーの設定
        this.setupInputListeners();
    }

    setupInputListeners() {
        // 共通パラメータのリスナー
        document.getElementById('envelope-max').addEventListener('input', (e) => {
            this.maxDb = Number(e.target.value);
            this.updateEditors();
            this.saveSettings();
        });

        document.getElementById('envelope-min').addEventListener('input', (e) => {
            this.minDb = Number(e.target.value);
            this.updateEditors();
            this.saveSettings();
        });

        // 開始部分のリスナー
        ['fadein', 'sustain', 'fadeout'].forEach(param => {
            document.getElementById(`start-${param}`).addEventListener('input', (e) => {
                this.startEditor.updateParams({
                    fadeTime: param === 'fadein' ? Number(e.target.value) : this.startEditor.params.fadeTime,
                    sustainTime: param === 'sustain' ? Number(e.target.value) : this.startEditor.params.sustainTime,
                    fadeOutTime: param === 'fadeout' ? Number(e.target.value) : this.startEditor.params.fadeOutTime,
                    maxDb: this.maxDb,
                    minDb: this.minDb
                });
                this.notifyChange();
                this.saveSettings();
            });
        });

        // 終了部分のリスナー
        ['fadein', 'sustain', 'fadeout'].forEach(param => {
            document.getElementById(`end-${param}`).addEventListener('input', (e) => {
                this.endEditor.updateParams({
                    fadeTime: param === 'fadein' ? Number(e.target.value) : this.endEditor.params.fadeTime,
                    sustainTime: param === 'sustain' ? Number(e.target.value) : this.endEditor.params.sustainTime,
                    fadeOutTime: param === 'fadeout' ? Number(e.target.value) : this.endEditor.params.fadeOutTime,
                    maxDb: this.maxDb,
                    minDb: this.minDb
                });
                this.notifyChange();
                this.saveSettings();
            });
        });
    }

    // 設定の保存
    saveSettings() {
        const settings = {
            fadeInTime1: this.startEditor.params.fadeTime,
            sustainTime1: this.startEditor.params.sustainTime,
            fadeOutTime1: this.startEditor.params.fadeOutTime,
            fadeInTime2: this.endEditor.params.fadeTime,
            sustainTime2: this.endEditor.params.sustainTime,
            fadeOutTime2: this.endEditor.params.fadeOutTime,
            maxDb: this.maxDb,
            minDb: this.minDb
        };
        try {
            localStorage.setItem('envelopeSettings', JSON.stringify(settings));
            console.log('Settings saved:', settings);
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    // 設定の読み込み
    loadSettings() {
        try {
            const savedSettings = localStorage.getItem('envelopeSettings');
            this.settings = savedSettings ? JSON.parse(savedSettings) : {
                fadeInTime1: 0.1,
                sustainTime1: 2.0,
                fadeOutTime1: 3.0,
                fadeInTime2: 0.5,
                sustainTime2: 2.0,
                fadeOutTime2: 0.5,
                maxDb: 0,
                minDb: -24
            };
            console.log('Settings loaded:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            // エラー時はデフォルト値を使用
            this.settings = {
                fadeInTime1: 0.1,
                sustainTime1: 2.0,
                fadeOutTime1: 3.0,
                fadeInTime2: 0.5,
                sustainTime2: 2.0,
                fadeOutTime2: 0.5,
                maxDb: 0,
                minDb: -24
            };
        }
    }

    // UIの値を更新
    updateUIValues() {
        try {
            document.getElementById('envelope-max').value = this.settings.maxDb;
            document.getElementById('envelope-min').value = this.settings.minDb;
            
            document.getElementById('start-fadein').value = this.settings.fadeInTime1;
            document.getElementById('start-sustain').value = this.settings.sustainTime1;
            document.getElementById('start-fadeout').value = this.settings.fadeOutTime1;
            
            document.getElementById('end-fadein').value = this.settings.fadeInTime2;
            document.getElementById('end-sustain').value = this.settings.sustainTime2;
            document.getElementById('end-fadeout').value = this.settings.fadeOutTime2;
        } catch (error) {
            console.error('Failed to update UI values:', error);
        }
    }

    // エディターの更新
    updateEditors() {
        this.startEditor.updateParams({
            maxDb: this.maxDb,
            minDb: this.minDb
        });
        this.endEditor.updateParams({
            maxDb: this.maxDb,
            minDb: this.minDb
        });
        this.notifyChange();
    }

    notifyChange() {
        if (this.onChange) {
            this.onChange({
                fadeInTime1: this.startEditor.params.fadeTime,
                sustainTime1: this.startEditor.params.sustainTime,
                fadeOutTime1: this.startEditor.params.fadeOutTime,
                fadeInTime2: this.endEditor.params.fadeTime,
                sustainTime2: this.endEditor.params.sustainTime,
                fadeOutTime2: this.endEditor.params.fadeOutTime,
                maxDb: this.maxDb,
                minDb: this.minDb
            });
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const mixer = new AudioMixer();
        mixer.initialize();
    });
} else {
    const mixer = new AudioMixer();
    mixer.initialize();
}

const style = document.createElement('style');
style.textContent = `
    .file-drop-area {
        padding: 20px;
        border: 2px dashed #ccc;
        border-radius: 8px;
        text-align: center;
        margin: 10px 0;
        transition: all 0.3s ease;
        background: #f8f8f8;
    }

    .file-drop-area.dragover {
        background: #e3f2fd;
        border-color: #2196F3;
    }

    .file-label {
        display: block;
        margin: 10px 0;
        color: #666;
    }

    .drop-text {
        color: #999;
        margin-top: 10px;
        font-size: 0.9em;
    }

    .file-drop-area input[type="file"] {
        display: none;
    }

    .file-controls {
        margin: 10px 0;
    }

    .audio-info {
        margin-top: 8px;
        font-size: 0.9em;
        color: #666;
    }

    .audio-info.error {
        color: #d32f2f;
    }

    .audio-info-table {
        display: grid;
        grid-template-columns: auto auto;
        gap: 4px 12px;
        margin-top: 4px;
        margin-left: 20px;
    }

    .audio-info-label {
        color: #888;
    }
`;
document.head.appendChild(style);
