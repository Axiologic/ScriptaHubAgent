/* Shared browser dictation, available before catalogue loading. */
(() => {
  'use strict';
  const labels = {
    en: { label: "What should the library recommend?", button: "Ask AI Librarian", dictate: "Dictate", stop: "Stop dictation", listening: "You can speak now. Your words will appear in the field.", unavailable: "Speech recognition is unavailable in this browser." },
    fr: { label: "Que devrait vous recommander la bibliothèque ?", button: "Demander au bibliothécaire IA", dictate: "Dicter", stop: "Arrêter la dictée", listening: "Vous pouvez parler maintenant. Vos mots apparaîtront dans le champ.", unavailable: "La reconnaissance vocale n’est pas disponible dans ce navigateur." },
    de: { label: "Was soll Ihnen die Bibliothek empfehlen?", button: "KI-Bibliothekar fragen", dictate: "Diktieren", stop: "Diktat stoppen", listening: "Sie können jetzt sprechen. Ihre Worte erscheinen im Eingabefeld.", unavailable: "Spracherkennung ist in diesem Browser nicht verfügbar." },
    es: { label: "¿Qué debería recomendarte la biblioteca?", button: "Preguntar al Bibliotecario IA", dictate: "Dictar", stop: "Detener dictado", listening: "Ya puedes hablar. Tus palabras aparecerán en el campo.", unavailable: "El reconocimiento de voz no está disponible en este navegador." },
    pt: { label: "O que a biblioteca deveria recomendar?", button: "Perguntar ao Bibliotecário IA", dictate: "Ditar", stop: "Parar ditado", listening: "Pode falar agora. As suas palavras aparecerão no campo.", unavailable: "O reconhecimento de voz não está disponível neste navegador." },
    it: { label: "Che cosa dovrebbe consigliarti la biblioteca?", button: "Chiedi al Bibliotecario IA", dictate: "Detta", stop: "Ferma dettatura", listening: "Puoi parlare ora. Le tue parole appariranno nel campo.", unavailable: "Il riconoscimento vocale non è disponibile in questo browser." },
    ro: { label: "Ce ai vrea să îți recomande biblioteca?", button: "Întreabă Bibliotecarul AI", dictate: "Dictează", stop: "Oprește dictarea", listening: "Acum poți vorbi. Textul dictat va apărea în câmp.", unavailable: "Recunoașterea vocală nu este disponibilă în acest browser." },
    pl: { label: "Co biblioteka powinna Ci polecić?", button: "Zapytaj Bibliotekarza AI", dictate: "Dyktuj", stop: "Zatrzymaj dyktowanie", listening: "Możesz teraz mówić. Dyktowany tekst pojawi się w polu.", unavailable: "Rozpoznawanie mowy nie jest dostępne w tej przeglądarce." },
  };
  const languages={en:'en-US',fr:'fr-FR',de:'de-DE',es:'es-ES',pt:'pt-PT',it:'it-IT',ro:'ro-RO',pl:'pl-PL'};
  function bind({input,button,status,language='en'}) {
    const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
    let active=null;
    const words=()=>labels[language]||labels.en;
    function render(){const text=!Recognition?words().unavailable:active?words().stop:words().dictate;button.disabled=!Recognition;button.title=text;button.setAttribute('aria-label',text);button.setAttribute('aria-pressed',String(!!active));}
    function stop(){const previous=active;active=null;render();status.textContent='';if(previous)previous.abort();}
    function toggle(){
      if(active){stop();return;}
      if(!Recognition)return;
      const startingText=input.value.trim();
      let recognition;
      try {
        recognition=new Recognition();active=recognition;
        recognition.lang=languages[language]||'en-US';recognition.continuous=true;recognition.interimResults=true;
        render();
        recognition.onstart=()=>{if(active===recognition)status.textContent=words().listening;};
        recognition.onresult=event=>{
          if(active!==recognition)return;
          const transcript=Array.from(event.results,result=>result[0].transcript.trim()).join(' ');
          const text=[startingText,transcript].filter(Boolean).join(' ');
          input.value=input.maxLength>0?text.slice(0,input.maxLength):text;
          input.dispatchEvent(new Event('input',{bubbles:true}));
        };
        recognition.onerror=()=>{if(active!==recognition)return;active=null;render();status.textContent=words().unavailable;};
        recognition.onend=()=>{if(active!==recognition)return;active=null;render();status.textContent='';};
        recognition.start();
      }catch(error){active=null;render();status.textContent=words().unavailable;}
    }
    const edit=event=>{if(event.isTrusted&&active)stop();};
    button.addEventListener('click',toggle);input.addEventListener('input',edit);
    addEventListener('pagehide',stop);render();
    return {stop,setLanguage(next){if(next!==language)stop();language=labels[next]?next:'en';render();},destroy(){stop();button.removeEventListener('click',toggle);input.removeEventListener('input',edit);removeEventListener('pagehide',stop);}};
  }
  globalThis.ScriptaDictation={bind};
})();
