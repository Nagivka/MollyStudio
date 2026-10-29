/** Soft synthesized cues and bundled Minecraft samples, loaded only on demand. */
export class UISoundPlayer {
    constructor(){this.enabled=false;this.volume=35;this.voices=new Set();this.lastCue=-Infinity;this.samples=new Map();this.pendingSamples=0;this.generation=0;}
    configure(settings){
        this.enabled=settings.uiSoundsEnabled===true;
        const profile=settings.uiSoundProfile||'auto';
        if(this.profile!==profile)this.stop();
        this.profile=profile;
        this.volume=Math.max(0,Math.min(100,Number(settings.uiSoundVolume)||0));
        if(this.master)this.master.gain.setValueAtTime(.1*(this.volume/100)**2,this.context.currentTime);
        if(!this.enabled||!this.volume)this.stop();
    }
    stop(){
        this.generation++;
        for(const voice of this.voices){try{voice.stop();}catch{}}
        this.voices.clear();
    }
    usesMinecraftSounds(){
        return this.profile==='pixel'||this.profile==='auto'&&globalThis.document?.documentElement?.dataset.theme?.includes('minecraft');
    }
    loadSample(kind){
        const name=kind==='save'?'save':'click';
        if(!this.samples.has(name)){
            const loading=fetch(new URL(`../../assets/sounds/minecraft/${name}.ogg`,import.meta.url))
                .then(response=>{if(!response.ok)throw Error('Sound unavailable');return response.arrayBuffer();})
                .then(data=>this.context.decodeAudioData(data));
            this.samples.set(name,loading);
            loading.catch(()=>{if(this.samples.get(name)===loading)this.samples.delete(name);});
        }
        return this.samples.get(name);
    }
    playSample(kind){
        if(this.voices.size+this.pendingSamples>=8)return false;
        const generation=this.generation,context=this.context;
        this.pendingSamples++;
        void this.loadSample(kind).then(buffer=>{
            if(generation!==this.generation||!this.enabled||!this.volume||globalThis.document?.hidden||!this.usesMinecraftSounds()||context.state==='closed')return;
            if(this.voices.size>=8)return;
            const source=context.createBufferSource();
            source.buffer=buffer;
            source.playbackRate.value=kind==='tab'?1.12:1;
            source.connect(this.master);this.voices.add(source);
            source.onended=()=>{source.disconnect();this.voices.delete(source);};
            source.start();
        }).catch(()=>{}).finally(()=>{this.pendingSamples--;});
        return true;
    }
    play(kind='click'){
        if(!this.enabled||!this.volume||globalThis.document?.hidden)return false;
        const now=performance.now();if(kind!=='save'&&now-this.lastCue<65)return false;
        try{
            if(!this.context||this.context.state==='closed'){
                const Audio=globalThis.AudioContext;if(!Audio)return false;
                this.context=new Audio();this.master=this.context.createGain();
                this.master.gain.value=.1*(this.volume/100)**2;this.master.connect(this.context.destination);
            }
            if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
            this.lastCue=now;
            const pixel=this.usesMinecraftSounds();
            if(pixel)return this.playSample(kind);
            const notes=kind==='save'?[[660,0,.09],[880,.075,.14]]:kind==='tab'?[[440,0,.055],[560,.035,.065]]:[[720,0,.045]];
            for(const [frequency,delay,duration] of notes){
                if(this.voices.size>=8)break;
                const oscillator=this.context.createOscillator(),envelope=this.context.createGain(),start=this.context.currentTime+delay;
                oscillator.type=kind==='click'?'triangle':'sine';oscillator.frequency.setValueAtTime(frequency,start);
                oscillator.frequency.exponentialRampToValueAtTime(frequency*.85,start+duration);
                envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(.7,start+.004);envelope.gain.exponentialRampToValueAtTime(.0001,start+duration);
                oscillator.connect(envelope);envelope.connect(this.master);this.voices.add(oscillator);
                oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();this.voices.delete(oscillator);};
                oscillator.start(start);oscillator.stop(start+duration+.01);
            }
            return true;
        }catch{this.stop();return false;}
    }
    suspend(){this.stop();if(this.context?.state==='running')void this.context.suspend().catch(()=>{});}
}

export const uiSounds=new UISoundPlayer();
export function syncUISounds(settings){uiSounds.configure(settings);}
let installed=false;
export function installUISounds(){
    if(installed)return;installed=true;
    document.addEventListener('click',event=>{
        if(event.defaultPrevented||event.button>0||event.target.closest?.('input,textarea,select,[data-ui-sound-preview]'))return;
        const target=event.target.closest?.('button,[role="button"],[role="tab"],.doc-tab,.menu-btn,.dropdown-item');
        if(!target||target.disabled||target.closest('[inert],[aria-disabled="true"]'))return;
        uiSounds.play(target.matches('[role="tab"],.doc-tab,.settings-tab-btn')?'tab':'click');
    });
    document.addEventListener('change',event=>{
        if(event.target.matches?.('select,input[type="checkbox"],input[type="radio"]')&&!event.target.disabled)uiSounds.play('click');
    });
    document.addEventListener('molly-project-saved',()=>uiSounds.play('save'));
    window.addEventListener('blur',()=>uiSounds.suspend());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)uiSounds.suspend();});
    window.addEventListener('pagehide',()=>{uiSounds.stop();void uiSounds.context?.close().catch(()=>{});});
}
