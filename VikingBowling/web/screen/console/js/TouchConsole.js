var VBSname;
var playerList = document.getElementById("playerNameList");
var actives = playerList.getElementsByClassName("radioActiv");
var playStyle = document.getElementById("playStyle");
var oddLaneActiveList = document.getElementById("oddLaneActiveList");
var evenLaneActiveList = document.getElementById("evenLaneActiveList");
var serviceWait = document.getElementById("serviceWait");
var AMRchangeActiveDivision = document.getElementById("AMRchangeActiveDivision");
var activePlayerLeft = 0;
var activePlayerRight = 8;
var lane = getLane();
var oddLane = lane % 2 ? lane : lane - 1;
var evenLane = oddLane + 1;
var lang = "English";
var configGameType = 0;
var configGameControl = 0;
var configMaxPlayers;		// WebMaxPlayers as last applied; undefined until a slave sends it
var configOrderButton;		// WebOrderButton as last applied; an older slave sends none, and no button shows
var practice = "";
var showEndPracticeButton = true;
var isAMR = false;
var customerDefinedFunction = true;
var numReservPlayers = -1;
var PinPattern = 0;

// Status arrives pushed on this lane's event stream instead of being fetched once a second -
// same URL parameters, same JSON, same fields (see commonAPI.js). Only the status *feed*
// changed: every command this console sends back (changeScore, stopBowling, changePlayersInfo,
// startBowling, SetPin ...) is still an ordinary $.ajax call made when the user presses a
// button, and is untouched.
var webSource = 'console';

function fetchLaneStatus(lane) {
  withLaneStatus(function( data ) {
    VBSname = data.VBSname;
    laneStatus = data.lanestatus;
    isAMR = data.isAMR === "1" ? true : false;

    if (laneStatus !== 'Playing' && data.slaveOffline === 'Yes') laneStatus = 'NoPlayer';

    if (oldLaneStatus !== laneStatus) oldLaneImgIndex = 0;

    enablePlayButtons(false);
    if (laneStatus === 'Messaging')
    {
      if (laneStatus === 'Playing' && data.disableConsole !== "Yes")
          enablePlayButtons(true);

      if (data.laneImgIndex !== oldLaneImgIndex)
      {
        oldLaneImgIndex = data.laneImgIndex;
        playMedia('../common/gamectrl/VTVFile' + getLane() + '.jpg?index=' + oldLaneImgIndex, laneStatus);
      }    
    }
    else if (laneStatus === 'Info')
    {
      hideBowlingMenuForm();
      if (data.laneImgIndex !== oldLaneImgIndex)
      {
        oldLaneImgIndex = data.laneImgIndex;
        playMedia('../common/gamectrl/VTVFile' + lane + '.jpg?index=' + oldLaneImgIndex, laneStatus);
      }    
    }    
    else if (laneStatus === 'Commercial')
    {
      hideBowlingMenuForm();
      var media = data.commercial;
      if (media === 'NoThingToPlay' || media === '' || media.indexOf(".webm") >= 0 || media.indexOf(".mp4") >= 0)
        playMedia('../common/img/VBSBowling_Dont_Move_or_Edit.jpg', laneStatus);
      else
        playMedia('../common/commercial/' + media, laneStatus);
    }
    else if (laneStatus === 'Playing')
    {
      if (data.disableConsole !== "Yes")
        enablePlayButtons(true);

      hideBowlingMenuForm();

      if (data.waitingSpace === "Yes"){
        $("#pressSpace").show();
        //default hidden to avoid extra button during startup.
        $("#pressSpace").css( "visibility","visible" );
      }
      else
        $("#pressSpace").hide();      

      if (data.laneImgIndex !== oldLaneImgIndex)
      {
        oldLaneImgIndex = data.laneImgIndex;
        playMedia('../common/gamectrl/VTVFile' + lane + '.jpg?index=' + oldLaneImgIndex, laneStatus);
      }
    }
    else if (laneStatus.indexOf('NoPlayer') === 0 && oldLaneStatus.indexOf('NoPlayer') === -1)
    {
      playMedia('../common/img/ClosedLane.png', laneStatus);
      showBowlingMenuForm();
    }

    if (numReservPlayers !== data.numReservPlayers)
    {
      numReservPlayers = data.numReservPlayers;
    }
    
    // The lane's own language (laneLang), as its scoresheet is drawn in; "lang" is the slave's,
    // one for all its lanes and read when LoadCom started. An older slave sends only "lang".
    // What the page shows can still differ: the guests may choose their own (touchconsoleLane.js).
    if (lang !== (data.laneLang || data.lang))
    {
      lang = data.laneLang || data.lang;
      ChangeLanguage();
    }

    if (configGameType !== data.WebGameType)
    {
      configGameType = data.WebGameType;
      ConfigGameType();
    }    

    if (configGameControl !== data.WebGameControl)
    {
      configGameControl = data.WebGameControl;
      ConfigGameControl();
    }

    // "Antal spelarfält", the start form's name rows (startBowling.js). An older slave sends no
    // field, and the rows stay as they are: all six, or a test's ?players=.
    if (data.WebMaxPlayers !== undefined && configMaxPlayers !== data.WebMaxPlayers)
    {
      configMaxPlayers = data.WebMaxPlayers;
      vbsApplyMaxPlayers(configMaxPlayers);
    }

    // "Beställ" (Terminalinställningar, Kimsoft): "Yes" puts the button on the dock.
    if (configOrderButton !== data.WebOrderButton)
    {
      configOrderButton = data.WebOrderButton;
      ConfigOrderButton();
    }

    if (practice !== data.practice)
    {
      practice = data.practice;
      ConfigPracticeControl();
    }    

    oldLaneStatus = laneStatus;
  });
}

function ConfigGameType() {
  let boolValues = { // Sequence below should not change!
    enable369: (configGameType & (1 << 0)) !== 0,
    enableMiniBowling: (configGameType & (1 << 1)) !== 0,
    enable10thFrame: (configGameType & (1 << 2)) !== 0,
    enableGSXtraining: (configGameType & (1 << 3)) !== 0,
    enableAMR: (configGameType & (1 << 4)) !== 0,
    enableNoTap: (configGameType & (1 << 5)) !== 0,
    enableShortGame: (configGameType & (1 << 6)) !== 0,
    enableStartMovedGame: (configGameType & (1 << 7)) !== 0,
  };

  gameType369.style.visibility = boolValues.enable369 ? "visible" : "hidden";
  gameTypeMini.style.visibility = boolValues.enableMiniBowling ? "visible" : "hidden";
  gameType10thFrame.style.visibility = boolValues.enable10thFrame ? "visible" : "hidden";  
  gameTypeGSXTrain.style.visibility = boolValues.enableGSXtraining ? "visible" : "hidden";    
  gameTypeAmr.style.visibility = boolValues.enableAMR ? "visible" : "hidden"; 
  NoTapDetails.style.visibility = boolValues.enableNoTap ? "visible" : "hidden";
  ShortGameDetails.style.visibility = boolValues.enableShortGame ? "visible" : "hidden";
  startMovePlayButton.style.visibility = boolValues.enableStartMovedGame ? "visible" : "hidden";
}

function ConfigGameControl() {
  let boolValues = { // Sequence below should not change!
    enableFinishGame: (configGameControl & (1 << 0)) !== 0,
    enableService: (configGameControl & (1 << 1)) !== 0,
    enableChangePlayer: (configGameControl & (1 << 2)) !== 0,
    enableCorrection: (configGameControl & (1 << 3)) !== 0,
    enableMoveGame: (configGameControl & (1 << 4)) !== 0,
    enableCustomerDefined: (configGameControl & (1 << 5)) !== 0,
  };
  showEndPracticeButton = (configGameControl & (1 << 6)) !== 0;

  stopBowlingbutton.style.visibility = boolValues.enableFinishGame ? "visible" : "hidden";
  callPersonalButton.style.visibility = boolValues.enableService ? "visible" : "hidden";
  changePlayerButton.style.visibility = boolValues.enableChangePlayer ? "visible" : "hidden";
  changeScoreButton.style.visibility = boolValues.enableCorrection ? "visible" : "hidden";
  saveMovePlayButton.style.visibility = boolValues.enableMoveGame ? "visible" : "hidden";
  customerDefinedFunction = boolValues.enableCustomerDefined;
  customButton.style.visibility = boolValues.enableCustomerDefined ? "visible" : "hidden";

  ConfigPracticeControl();
}

// The "Beställ" button: hidden until the slave says "Yes" (touchconsoleLane.css keeps it hidden until
// then), and an order page that is open when the hall switches it off is closed.
function ConfigOrderButton() {
  var button = document.getElementById("orderWidgetButton");
  if (!button) return;
  var on = configOrderButton === "Yes";
  button.style.visibility = on ? "visible" : "hidden";
  if (!on && window.location.hash === "#orderWidgetMenu") window.location.hash = "";
}

// The order page is orderwidget.html beside this page: the reception writes it from the snippet pasted
// in Terminalinställningar and copies it to every scoring computer. It is fetched each time the dialog
// opens - so a page saved since is the one shown - and #LANE# in it becomes this lane's number BEFORE
// it runs, so the provider's own address can carry the lane (?lane=#LANE#). Shown through srcdoc,
// which keeps this page's origin and folder for the snippet's relative addresses.
function vbsOrderWidgetHtml(text, laneNo) {
  return String(text).split("#LANE#").join(String(laneNo));
}
function openOrderWidget() {
  var frame = document.getElementById("orderWidgetFrame");
  if (!frame) return;
  frame.srcdoc = "";
  var asked = ++openOrderWidget.asked;
  fetch("orderwidget.html?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
    .then(function (text) {
      // Only into the dialog it was asked for: closed and opened again meanwhile, the newer one wins.
      // The lane as a number only: getLane() hands back the address's parameter as it was given.
      var laneNo = vbsSaneLane(getLane());
      if (asked === openOrderWidget.asked && window.location.hash === "#orderWidgetMenu" && laneNo)
        frame.srcdoc = vbsOrderWidgetHtml(text, laneNo);
    })
    .catch(function (e) { console.warn("Order page orderwidget.html could not be fetched: " + e); });
}
openOrderWidget.asked = 0;
// Opened by the button's #orderWidgetMenu (the overlay is a :target); emptied again when it closes, so
// nothing of a provider's page goes on running behind the lane's screen.
function followOrderWidget() {
  var frame = document.getElementById("orderWidgetFrame");
  if (!frame) return;
  if (window.location.hash === "#orderWidgetMenu") openOrderWidget();
  else if (frame.srcdoc) { ++openOrderWidget.asked; frame.srcdoc = ""; }
}
window.addEventListener("hashchange", followOrderWidget);

function ConfigPracticeControl() {
  if (!showEndPracticeButton)
    finishPractice.style.visibility = "hidden";
  else
    finishPractice.style.visibility = practice === "Yes" ? "visible" : "hidden";
}

function ChangeLanguage() {
  var nameInputs = document.getElementsByClassName("playerName");

  switch(lang.toLowerCase()) {
     case "svenska":
      $("#stopBowlingbutton").text("Avsluta spel");
      $("#callPersonalButton").text("Service");
      $("#changePlayerButton").text("Ändra spelare");
      $("#changeScoreButton").text("Korrigera");
      $("#VBSTchangePlayerButton").text("Byt in reserv");
      $("#saveMovePlayButton").text("Flytta spel");
      $("#cancelButton").text("Avbryt");
      $("#addScoreButton").text("Lägg till");
      $("#pinSetSubmitbutton").text("Ställ andraslag"); 
      $("#pinResetSubmitbutton").text("Ställ förstaslag");
			$("#cancelpinSettersubmitbutton").text("Avbryt");
      $("#deleteScoreButton").text("Ta bort");
      $("#changescoresubmitbutton").text("Spara");
      $("#startMovePlaysubmitbutton").text("Starta");
      $("#cancelMovePlaysubmitbutton").text("Avbryt");
      $("#beginToMoveTitle").text("Starta flyttat spel");
      $("#confirmationTitle").text("Är du säker?");
      $("#correctTitle").text("Korrigera");
      $("#moveGameTitle").text("Flytta spel");
      $("#saveMovePlaysubmitbutton").text("Flytta");
      $("#cancelSaveMovePlaysubmitbutton").text("Avbryt");
      $("#changeInReserveTitle").text("Byt in reservspelare");
      $("#changeOutReserveTitle").text("Byt ut spelare");
      $("#withThisPlayerTitle").text("Med denna spelare");
      $("#changePlayersubmitbutton").text("Byt ut/in");
      $("#cancelChangePlayersubmitbutton").text("Avbryt");
      $("#changePlayerTitle").text("Ändra spelare");
      $("#changePlayerNameLabel").text("Spelarnamn");
      $("#changePlayerBumpLabel").text("Bumpers");
      $("#changePlayerPositionLabel").text("Position");
      $("#changePlayerRemoveLabel").text("Ta bort");
      $("#changePlayerInfoSubmitButton").text("Spara");
      $("#addplayerbutton").text("Lägg till spelare");
      $("#stopGameTitle").text("Varning");
      $("#stopPracticeTitle").text("Varning");
      $("#stopGameWarning").text("Avsluta pågående spel?");
      $("#stopPracticeWarning").text("Avsluta pågående inspelning?");
      $("#stopBowlingsubmitbutton").text("Avsluta Spel");
      $("#stopGameCancel").text("Avbryt");
      $("#stopPracticeCancel").text("Avbryt");
      $("#serviceTitle").text("Tillkalla personal");
      $("#serviceWait").text("Personal tillkallad, vänta!");
      $("#callPersonalsubmitbutton").text("Tillkalla personal");
      $("#callPersonalCancel").text("Avbryt");
      $("#startMovePlayButton").text("Starta flyttat spel");
      $("#startMovePlayCancel").text("Avbryt");
      $("#gameType10Pin").text("Vanlig Bowling");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10:e Frame");
      $("#gameTypeGSXTrain").text("GSX Träning");
      $("#gameTypeAmr").text("Amerikanskt lösspel");
      $("#selectGamingformatTitle").text("Välj Spel");
      $("#startBowling").text("Starta Vanlig Bowling");
	  $("#startTraning").text("Starta GSX Träning");
      $(".otherBowlingButton").text("Andra Spelsätt");
      $("#playStyle").text("Aktiv");
      $("#finishPractice").text("Avsluta inspelning");
      $("#stopPracticeSubmitbutton").text("Avsluta inspelning");	
      
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Spelarnamn";

      break;
    case "suomeksi":
      $("#stopBowlingbutton").text("Lopeta peli");
      $("#callPersonalButton").text("Kutsu apua");
      $("#changePlayerButton").text("Pelaajamuutokset");
      $("#changeScoreButton").text("Tuloksen korjaus");
      $("#VBSTchangePlayerButton").text("Vaihda pelaajaa");
      $("#saveMovePlayButton").text("Siirrä peli radalle");
      $("#cancelButton").text("Peruuta");
      $("#addScoreButton").text("Lisää");
      $("#pinSetSubmitbutton").text("Viimeinen keilakuvio");
      $("#pinResetSubmitbutton").text("Nosta keilat");
			$("#cancelpinSettersubmitbutton").text("Peruuta");
      $("#deleteScoreButton").text("Poista");
      $("#changescoresubmitbutton").text("Tallenna");
      $("#startMovePlaysubmitbutton").text("Siirrä");
      $("#cancelMovePlaysubmitbutton").text("Peruuta");
      $("#beginToMoveTitle").text("Käynnistä siirretty peli");
      $("#confirmationTitle").text("Oletko varma?");
      $("#correctTitle").text("Tuloksen korjaus");
      $("#moveGameTitle").text("Siirrä peli");
      $("#saveMovePlaysubmitbutton").text("Siirrä");
      $("#cancelSaveMovePlaysubmitbutton").text("Peruuta");
      $("#changeInReserveTitle").text("Korvauspelaaja");
      $("#changeOutReserveTitle").text("Vaihtopelaaja");
      $("#withThisPlayerTitle").text("Tällä pelaajalla");
      $("#changePlayersubmitbutton").text("Vaihtopelaaja pois/sisään");
      $("#cancelChangePlayersubmitbutton").text("Peruuta");
      $("#changePlayerTitle").text("Vaihda pelaajaa");
      $("#changePlayerNameLabel").text("Pelaajanimi");
      $("#changePlayerBumpLabel").text("Kaiteet");
      $("#changePlayerPositionLabel").text("Vaihda järjestys");
      $("#changePlayerRemoveLabel").text("Poista");
      $("#changePlayerInfoSubmitButton").text("Tallenna");
      $("#addplayerbutton").text("Lisää pelaaja");
      $("#stopGameTitle").text("Varoitus");
      $("#stopPracticeTitle").text("Varoitus");
      $("#stopGameWarning").text("Lopeta peli?");
      $("#stopPracticeWarning").text("Lopeta harjoitus?");
      $("#stopBowlingsubmitbutton").text("Lopeta peli");
      $("#stopGameCancel").text("Peruuta");
      $("#stopPracticeCancel").text("Peruuta");      
      $("#serviceTitle").text("Kutsu apua");
      $("#serviceWait").text("Henkilökunnalle on viestisi. Annettu, odota!");
      $("#callPersonalsubmitbutton").text("Kutsu apua");
      $("#callPersonalCancel").text("Poistu");
      $("#startMovePlayButton").text("Käynnistä siirretty peli");
      $("#startMovePlayCancel").text("Poistu");
      $("#gameType10Pin").text("Normaali Harjoituspeli");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10th Frame");
      $("#gameTypeGSXTrain").text("GSX Harjoitus");
      $("#gameTypeAmr").text("Harjoituspeli AMR");
      $("#selectGamingformatTitle").text("Valitse pelitapa");
      $("#startBowling").text("Käynnistä Harjoituspeli");
	  $("#startTraning").text("Start Practice");
      $(".otherBowlingButton").text("Muut pelitavat");   
      $("#playStyle").text("Aktiivinen");   
      $("#finishPractice").text("Lopeta harjoitus");
      $("#stopPracticeSubmitbutton").text("Lopeta harjoitus");
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Pelaajanimi";

      break;  
    case "deutsch":    

      $("#stopBowlingbutton").text("Finish game");
      $("#callPersonalButton").text("Service");
      $("#changePlayerButton").text("Spielermenü");
      $("#changeScoreButton").text("Correct");
      $("#VBSTchangePlayerButton").text("Change in reserve");
      $("#saveMovePlayButton").text("Bewegen spiel");
      $("#cancelButton").text("Abbrechen");
      $("#addScoreButton").text("Hinzufügen");
      $("#pinSetSubmitbutton").text("Set pins to last pattern");
      $("#pinResetSubmitbutton").text("Reset pins");
      $("#cancelpinSettersubmitbutton").text("Abbrechen");
      $("#deleteScoreButton").text("Löschen");
      $("#changescoresubmitbutton").text("Speichern");
      $("#startMovePlaysubmitbutton").text("Start");
      $("#cancelMovePlaysubmitbutton").text("Abbrechen");
      $("#beginToMoveTitle").text("Start move game");
      $("#confirmationTitle").text("Bist du sicher?");
      $("#correctTitle").text("Correct");
      $("#moveGameTitle").text("Move game");
      $("#saveMovePlaysubmitbutton").text("Bewegen");
      $("#cancelSaveMovePlaysubmitbutton").text("Abbrechen");
      $("#changeInReserveTitle").text("Change in reserve player");
      $("#changeOutReserveTitle").text("Change out player");
      $("#withThisPlayerTitle").text("With this player");
      $("#changePlayersubmitbutton").text("Change out/in");
      $("#cancelChangePlayersubmitbutton").text("Abbrechen");
      $("#changePlayerTitle").text("Spielermenü");
      $("#changePlayerNameLabel").text("Spielername");
      $("#changePlayerBumpLabel").text("Bumpers");
      $("#changePlayerPositionLabel").text("Position");
      $("#changePlayerRemoveLabel").text("Löschen");
      $("#changePlayerInfoSubmitButton").text("Speichern");
      $("#addplayerbutton").text("Speiler hinzufügen");
      $("#stopGameTitle").text("Warning");
      $("#stopPracticeTitle").text("Warning");
      $("#stopGameWarning").text("Finish the ongoing game?");
      $("#stopPracticeWarning").text("Finish the ongoing practice?");
      $("#stopBowlingsubmitbutton").text("Finish game");
      $("#stopGameCancel").text("Abbrechen");
      $("#stopPracticeCancel").text("Abbrechen");
      $("#serviceTitle").text("Service rufen");
      $("#serviceWait").text("Service man comming... wait!");
      $("#callPersonalsubmitbutton").text("Service rufen");
      $("#callPersonalCancel").text("Abbrechen");
      $("#startMovePlayButton").text("Start move game");
      $("#startMovePlayCancel").text("Abbrechen");
      $("#gameType10Pin").text("Normal Bowling");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10th Frame");
      $("#gameTypeGSXTrain").text("GSX Training");
      $("#gameTypeAmr").text("American OpenPlay");
      $("#selectGamingformatTitle").text("Select game");
      $("#startBowling").text("Start normal bowl");
      $(".otherBowlingButton").text("Other bowling modes");
      $("#startTraning").text("Start Practice");
      $("#playStyle").text("Aktiv");
      $("#finishPractice").text("Übung beenden");   
      $("#stopPracticeSubmitbutton").text("Übung beenden");   
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Spielername";

      break; 

    case "dansk":
		
      $("#stopBowlingbutton").text("Afslut spil");
      $("#callPersonalButton").text("Service");
      $("#changePlayerButton").text("Skift spiller");
      $("#changeScoreButton").text("Ret scoren");
      $("#VBSTchangePlayerButton").text("Indsætte en reserve");
      $("#saveMovePlayButton").text("Flyt spil");
      $("#cancelButton").text("Afbryd");
      $("#addScoreButton").text("Tillføje");
      $("#pinSetSubmitbutton").text("Andet Slag"); 
      $("#pinResetSubmitbutton").text("Første Slag");
      $("#cancelpinSettersubmitbutton").text("Afbryd");
      $("#deleteScoreButton").text("Fjern");
      $("#changescoresubmitbutton").text("Gem");
      $("#startMovePlaysubmitbutton").text("Start");
      $("#cancelMovePlaysubmitbutton").text("Afbryd");
      $("#beginToMoveTitle").text("Starten flyttede spillet");
      $("#confirmationTitle").text("Er du sikker?");
      $("#correctTitle").text("Ret scoren");
      $("#moveGameTitle").text("Flyt spil");
      $("#saveMovePlaysubmitbutton").text("Flytte");
      $("#cancelSaveMovePlaysubmitbutton").text("Afbryd");
      $("#changeInReserveTitle").text("Indskift en reservespiller");
      $("#changeOutReserveTitle").text("Udskiftningsspillere");
      $("#withThisPlayerTitle").text("Med denne afspiller");
      $("#changePlayersubmitbutton").text("Udskifte / Indsætte");
      $("#cancelChangePlayersubmitbutton").text("Afbryd");
      $("#changePlayerTitle").text("Skift spiller");
      $("#changePlayerNameLabel").text("Spillernavn");
      $("#changePlayerBumpLabel").text("Bumpers");
      $("#changePlayerPositionLabel").text("Position");
      $("#changePlayerRemoveLabel").text("Fjern");
      $("#changePlayerInfoSubmitButton").text("Gem");
      $("#addplayerbutton").text("Tillføje spiller");
      $("#stopGameTitle").text("Advarsel");
      $("#stopPracticeTitle").text("Advarsel");
      $("#stopGameWarning").text("Afslut det nuværende spil?");
      $("#stopPracticeWarning").text("Afslut igangværende optagelse?");
      $("#stopBowlingsubmitbutton").text("Afslut spil");
      $("#stopGameCancel").text("Afbryd");
      $("#stopPracticeCancel").text("Afbryd");
      $("#serviceTitle").text("Tilkald Hjælp");
      $("#serviceWait").text("Personale tilkaldt – vent venligst!");
      $("#callPersonalsubmitbutton").text("Tilkald Hjælp");
      $("#callPersonalCancel").text("Afbryd");
      $("#startMovePlayButton").text("Starten flyttede spillet");
      $("#startMovePlayCancel").text("Afbryd");
      $("#gameType10Pin").text("Bowling");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10:e Frame");
      $("#gameTypeGSXTrain").text("Træning");
      $("#gameTypeAmr").text("Amerikansk stil");
      $("#selectGamingformatTitle").text("Vælg spil");
      $("#startBowling").text("Start Bowling");
      $(".otherBowlingButton").text("Andre spil");
	  $("#startTraning").text("Start");
      $("#playStyle").text("Aktiv");
      $("#finishPractice").text("Stop optagelse");
      $("#stopPracticeSubmitbutton").text("Stop optagelse");
      
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Spillernavn";

      break; 
			
    case "norsk":           
    case "english":  
      $("#stopBowlingbutton").text("Finish game");
      $("#callPersonalButton").text("Service");
      $("#changePlayerButton").text("Change player");
      $("#changeScoreButton").text("Correct");
      $("#VBSTchangePlayerButton").text("Change in reserve");
      $("#saveMovePlayButton").text("Move game");
      $("#cancelButton").text("Cancel");
      $("#addScoreButton").text("Add");
      $("#pinSetSubmitbutton").text("Set pins to last pattern");
      $("#pinResetSubmitbutton").text("Reset pins");
      $("#cancelpinSettersubmitbutton").text("Cancel");
      $("#deleteScoreButton").text("Remove");
      $("#changescoresubmitbutton").text("Save");
      $("#startMovePlaysubmitbutton").text("Start");
      $("#cancelMovePlaysubmitbutton").text("Cancel");
      $("#beginToMoveTitle").text("Start move game");
      $("#confirmationTitle").text("Are you sure?");
      $("#correctTitle").text("Correct");
      $("#moveGameTitle").text("Move game");
      $("#saveMovePlaysubmitbutton").text("Move");
      $("#cancelSaveMovePlaysubmitbutton").text("Cancel");
      $("#changeInReserveTitle").text("Change in reserve player");
      $("#changeOutReserveTitle").text("Change out player");
      $("#withThisPlayerTitle").text("With this player");
      $("#changePlayersubmitbutton").text("Change out/in");
      $("#cancelChangePlayersubmitbutton").text("Cancel");
      $("#changePlayerTitle").text("Change player info");
      $("#changePlayerNameLabel").text("Player name");
      $("#changePlayerBumpLabel").text("Bumpers");
      $("#changePlayerPositionLabel").text("Position");
      $("#changePlayerRemoveLabel").text("Remove");
      $("#changePlayerInfoSubmitButton").text("Save");
      $("#addplayerbutton").text("Add player");
      $("#stopGameTitle").text("Warning");
      $("#stopPracticeTitle").text("Warning");
      $("#stopGameWarning").text("Finish the ongoing game?");
      $("#stopPracticeWarning").text("Finish the ongoing practice?");
      $("#stopBowlingsubmitbutton").text("Finish game");
      $("#stopGameCancel").text("Cancel");
      $("#stopPracticeCancel").text("Cancel");
      $("#serviceTitle").text("Call for help");
      $("#serviceWait").text("Service man comming... wait!");
      $("#callPersonalsubmitbutton").text("Call for help");
      $("#callPersonalCancel").text("Cancel");
      $("#startMovePlayButton").text("Start move game");
      $("#startMovePlayCancel").text("Cancel");
      $("#gameType10Pin").text("Normal Bowling");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10th Frame");
      $("#gameTypeGSXTrain").text("GSX Training");
      $("#gameTypeAmr").text("American OpenPlay");
      $("#selectGamingformatTitle").text("Select game");
      $("#startBowling").text("Start normal bowl");
      $(".otherBowlingButton").text("Other bowling modes");
	  $("#startTraning").text("Start Practice");			
      $("#playStyle").text("Active");  
      $("#finishPractice").text("End practice");    
      $("#stopPracticeSubmitbutton").text("End practice");    
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Player name";
      break; 
    default:
      $("#stopBowlingbutton").text("Finish game");
      $("#callPersonalButton").text("Service");
      $("#changePlayerButton").text("Change player");
      $("#changeScoreButton").text("Correct");
      $("#VBSTchangePlayerButton").text("Change in reserve");
      $("#saveMovePlayButton").text("Move game");
      $("#cancelButton").text("Cancel");
      $("#addScoreButton").text("Add");
      $("#pinSetSubmitbutton").text("Set pins to last pattern");
      $("#pinResetSubmitbutton").text("Reset pins");
      $("#cancelpinSettersubmitbutton").text("Cancel");
      $("#deleteScoreButton").text("Remove");
      $("#changescoresubmitbutton").text("Save");
      $("#startMovePlaysubmitbutton").text("Start");
      $("#cancelMovePlaysubmitbutton").text("Cancel");
      $("#beginToMoveTitle").text("Start move game");
      $("#confirmationTitle").text("Are you sure?");
      $("#correctTitle").text("Correct");
      $("#moveGameTitle").text("Move game");
      $("#saveMovePlaysubmitbutton").text("Move");
      $("#cancelSaveMovePlaysubmitbutton").text("Cancel");
      $("#changeInReserveTitle").text("Change in reserve player");
      $("#changeOutReserveTitle").text("Change out player");
      $("#withThisPlayerTitle").text("With this player");
      $("#changePlayersubmitbutton").text("Change out/in");
      $("#cancelChangePlayersubmitbutton").text("Cancel");
      $("#changePlayerTitle").text("Change player info");
      $("#changePlayerNameLabel").text("Player name");
      $("#changePlayerBumpLabel").text("Bumpers");
      $("#changePlayerPositionLabel").text("Position");
      $("#changePlayerRemoveLabel").text("Remove");
      $("#changePlayerInfoSubmitButton").text("Save");
      $("#addplayerbutton").text("Add player");
      $("#stopGameTitle").text("Warning");
      $("#stopPracticeTitle").text("Warning");
      $("#stopGameWarning").text("Finish the ongoing game?");
      $("#stopPracticeWarning").text("Finish the ongoing practice?");
      $("#stopBowlingsubmitbutton").text("Finish game");
      $("#stopGameCancel").text("Cancel");
      $("#stopPracticeCancel").text("Cancel");
      $("#serviceTitle").text("Call for help");
      $("#serviceWait").text("Service man comming... wait!");
      $("#callPersonalsubmitbutton").text("Call for help");
      $("#callPersonalCancel").text("Cancel");
      $("#startMovePlayButton").text("Start move game");
      $("#startMovePlayCancel").text("Cancel");
      $("#gameType10Pin").text("Normal Bowling");
      $("#gameType369").text("3-6-9");
      $("#gameTypeMini").text("Mini Bowling");
      $("#gameType10thFrame").text("10th Frame");
      $("#gameTypeGSXTrain").text("GSX Training");
      $("#gameTypeAmr").text("American OpenPlay");
      $("#selectGamingformatTitle").text("Select game");
      $("#startBowling").text("Start normal bowl");
      $(".otherBowlingButton").text("Other bowling modes");
	  $("#startTraning").text("Start Practice");			
      $("#playStyle").text("Active");  
      $("#finishPractice").text("End practice");    
      $("#stopPracticeSubmitbutton").text("End practice");    
      for (var i=0; i< nameInputs.length; i++)
        nameInputs[i].placeholder = "Player name";
      break; 
  }
}

function AddPlayer(player) {
  // Bredder och marginaler sätts av .playerGrid/.playerRow i vbs.css, så att raden
  // hamnar i exakt samma kolumner som rubrikraden ovanför listan.
  var Spelarnamn = document.createElement("input");
  Spelarnamn.type = "text";
  Spelarnamn.value = player === null ? "" : player.name;
  Spelarnamn.className = "Spelarnamn";
  Spelarnamn.oninput = adjustCaps;
  Spelarnamn.onfocus = function() { selectAll(Spelarnamn); };
  Spelarnamn.setAttribute("maxlength", "60");

  var Bumpers = document.createElement("input");
  Bumpers.type = "checkbox";
  Bumpers.className = "checkboxBump";
  if (player === null)
    Bumpers.checked = false;
  else
    Bumpers.checked = player.bump == "1" ? true : false;

  var btnUpp = document.createElement("button");
  btnUpp.innerHTML = "¨";
  btnUpp.onclick = movePlayerUpp;
  btnUpp.className = "btnUp";

  var btnDown = document.createElement("button");
  btnDown.innerHTML = "¨";
  btnDown.onclick = movePlayerDown;
  btnDown.className = "btnDown";

  var btnRemove = document.createElement("button");
  btnRemove.innerHTML = "¨";
  btnRemove.onclick = removePlayer;
  btnRemove.className = "btnRemove";

  var playerDiv = document.createElement("div");

  var Aktiv = document.createElement("input");
  Aktiv.type = "radio";
  Aktiv.name = "activePlayer";
  Aktiv.className = "radioActiv";
  // visibility, inte display: kolumnen måste finnas kvar även i AMR-läge,
  // annars glider raden ur led mot rubrikraden (som döljer "Aktiv" likadant).
  Aktiv.style.visibility = isAMR ? 'hidden' : 'visible';
  playerDiv.append(Aktiv);

  playerDiv.id = player === null ? -1 : player.playerIdNumber;
  playerDiv.append(Spelarnamn);
  playerDiv.append(Bumpers);
  playerDiv.append(btnUpp);
  playerDiv.append(btnDown);
  playerDiv.append(btnRemove);

  playerDiv.draggable = "true";
  playerDiv.className = "playerGrid playerRow";

  playerList.append(playerDiv);
}

function fetchLastPlayedPinPattern() {
  $.ajax({
    url: '/console/lastPlayedPinPattern?lane=' + getLane(),
    type: 'get',
    dataType: 'json',
    success: function(responsedata) {
      var pin, pinID;
      for (var i=9; i>=0; i--)
      {
          pinID = "pin" + (i + 1);
          pin = document.getElementById(pinID);
          pin.checked = ((responsedata.pinPattern >> i) & 1)
      }
    }
});
}

// The serie the change players form was filled from, sent back with the list so that the slave can
// refuse it if the lane has moved on (it also refuses a list naming a bowler no longer on the lane).
// And the bowlers it was filled with, because a list only names who stays: the slave refuses it if
// somebody has come onto the lane since, whom saving it would take off. -1 for an empty lane.
var playersOfGame, playersSeen;

function updatePlayerInfo() {
  $.getJSON('/console/players.json?lane=' + lane, function( data ) {
    $('#playerNameList').html('');
    playersOfGame = data.players.length > 0 ? data.players[0].activeGame : undefined;
    playersSeen = data.players.length > 0 ? data.players.map(function (p) { return p.playerIdNumber; }).join(",") : "-1";

    if (isAMR)
    {
      playStyle.style.visibility = 'hidden';
      AMRchangeActivePlayerButton.style.visibility = 'visible';
    }
    else
    {
      playStyle.style.visibility = 'visible';
      AMRchangeActivePlayerButton.style.visibility = 'hidden';
    }

    activePlayer = data.activePlayer;
		playStyle.style.textAlign ="center";

    for (var i=0; i < data.players.length; i++)
    {
      var player = data.players[i];
      AddPlayer(player);

      if (!isAMR && i == activePlayer)
      {
        actives[i].checked = true;
      }
    }
  });
}

function isDataValid()
{
  var spelarnamns = playerList.getElementsByClassName("Spelarnamn");
  var valid = false;

  if (isAMR)
  {
    valid = true;
  }
  else
  {
    for (var i=0; i< actives.length; i++)
    {
      if (actives[i].checked === true)
      {
        activePlayer = i;
        valid = true;
        break;
      }
    }
  }

  if (!valid)
  {
    alert("Please select active player !");
    return false;
  }

  for (var i=0; i< spelarnamns.length; i++)
  {
    if (spelarnamns[i].value.trim() === "")
    {
      alert("Player name cannot be empty !");
      return false;
    }
  }

  return valid;
}

function submitChangePlayerInfoForm() {
  if (!isDataValid()) return;

  var bumpers = playerList.getElementsByClassName("checkboxBump");
  var spelarnamns = playerList.getElementsByClassName("Spelarnamn");

  var formdata = "";
  var players = playerList.getElementsByTagName("div");

  for (let i = 0; i < players.length; i++) {
    var playerName = "player" + i + "Name";
    // Encoded, then the bumper marker appended outside it: "PlusC" is the code's own
    // text, which the slave turns back into "+C", so it must not be escaped.
    formdata += playerName + "=" + encodeURIComponent(spelarnamns[i].value) + (bumpers[i].checked ? "PlusC" : '') + "&";
    var playerID = "player" + i + "ID";
    formdata += playerID + "=" + encodeURIComponent(players[i].id) + "&";
  }

  if (playersOfGame !== undefined) formdata += "game=" + playersOfGame + "&";
  if (playersSeen !== undefined) formdata += "seen=" + playersSeen + "&";
  formdata += "activePlayer=" + activePlayer;

  $.ajax({
      url: '/console/changePlayersInfo?lane=' + lane,
      type: 'get',
      dataType: 'json',
      data: formdata,
      success: function(responsedata) {
        if (responsedata && responsedata.success === "false" && responsedata.reason === "laneMovedOn") {
          // Nothing was written, and the form shows the lane as it is now.
          alert(laneMovedOnMessage());
          updatePlayerInfo();
          return;
        }
        $("#ChangePlayerForm")[0].reset();
        removeAnchorFromUrl();
      }
  });
}

function enablePlayButtons(show) {
  if (show)
  {
    $(".lanebuttons").show();
    if (VBSname.search("VBS") >= 0 && numReservPlayers > 0) {
      $("#VBSTchangePlayerButton").show();
      //default hidden to avoid extra button during startup.
      $("#VBSTchangePlayerButton").css( "visibility","visible" );      
    }
    else
      $("#VBSTchangePlayerButton").hide();

    if (saveMovePlayButton.style.visibility === "hidden")
      $("#saveMovePlayButton").hide();
    else
    {
      if (VBSname.trim().length > 4) 
        $("#saveMovePlayButton").hide();
      else {
        $("#saveMovePlayButton").show();      
        //default hidden to avoid extra button during startup.      
        $("#saveMovePlayButton").css( "visibility","visible" ); 
      }
    }
  }
  else 
    $(".lanebuttons").hide();
}

function submitStopBowling() {
  $.ajax({
      url: '/console/stopBowling?lane=' + lane,
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        $("#stopGame").hide();
        $("#fillBowlingData").show();
        ChangeLanguage();
      }
  });
}

function submitcallPersonalsubmit() {
  $.ajax({
      url: '/console/callPersonal?lane=' + lane,
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        serviceWait.hidden = false;
      }
  });
}

function submitPinResetLane() {
  $.ajax({
      url: '/console/ResetPin?lane=' + lane,
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        removeAnchorFromUrl();
      }
  });
}

function submitPinSetLane() {
  var pin, pinID;
  PinPattern = 0;

  for (var i = 9; i >= 0; i--) {
    pinID = "pin" + (i + 1);
    pin = document.getElementById(pinID);
    PinPattern = (PinPattern << 1) | pin.checked;
  }

  $.ajax({
    url: '/console/SetPin',
    type: 'get',
    dataType: 'json',
    data: {
        lane: lane,
        PinPattern: PinPattern
    },
    success: function(responsedata) {
        removeAnchorFromUrl();
    }
});
}

function resetCallPersonalForm() {
  var text = document.getElementById("serviceTitle");
  text.style.color = "black";
  serviceWait.hidden = true;
}

function resetstopBowlingForm() {
  $('#stopGame').show();
}

function addPlayerAction() {
  // Up to the eight a lane holds, or to "Antal spelarfält" when the hall chose fewer than six
  // (vbsChangePlayersMax, startBowling.js). Bowlers already on the lane are never taken off.
  var max = typeof vbsChangePlayersMax === "function" ? vbsChangePlayersMax() : 8;
  if (playerList.childElementCount < max) {
    AddPlayer(null);
    
    // If this is the first player being added (list was empty), make them active
    if (playerList.childElementCount === 1 && !isAMR) {
      var radioButtons = playerList.getElementsByClassName("radioActiv");
      if (radioButtons.length > 0) {
        radioButtons[0].checked = true;
        activePlayer = 0;
      }
    }
  }
}

function removePlayer() {
  var playerToRemove = document.getElementById(document.activeElement.parentNode.id);
  var radioButtons = playerToRemove.getElementsByClassName("radioActiv");
  var wasActivePlayer = radioButtons.length > 0 && radioButtons[0].checked;
  
  // Get the index of the player being removed
  var playerIndex = Array.from(playerList.children).indexOf(playerToRemove);
  
  playerList.removeChild(playerToRemove);
  
  // If the removed player was active, make the next player active
  if (wasActivePlayer && !isAMR) {
    var updatedActives = playerList.getElementsByClassName("radioActiv");
    
    // If there are still players, set the active player
    if (updatedActives.length > 0) {
      var nextIndex = playerIndex;
      
      // If the removed player was not the last one, the next player is now at playerIndex
      // If it was the last one, set the previous player (now at playerIndex - 1)
      if (nextIndex >= updatedActives.length) {
        nextIndex = updatedActives.length - 1;
      }
      
      if (nextIndex >= 0) {
        // Uncheck all radio buttons first
        for (var i = 0; i < updatedActives.length; i++) {
          updatedActives[i].checked = false;
        }
        // Then check the one we want
        updatedActives[nextIndex].checked = true;
        activePlayer = nextIndex;
      }
    }
  }
}

function deepClone(source) {
  var clone = source.cloneNode(true);
  var buttons = clone.getElementsByTagName("button");

  buttons[0].onclick = movePlayerUpp;
  buttons[1].onclick = movePlayerDown;
  buttons[2].onclick = removePlayer;
  return clone;
}


function movePlayerUpp() {
  if (playerList.firstChild.id === document.activeElement.parentNode.id)
    return;

  var source = document.getElementById(document.activeElement.parentNode.id);
  var clone = deepClone(source.previousSibling);
  playerList.replaceChild(source, source.previousSibling)
  playerList.insertBefore(clone, source.nextSibling);
}

function movePlayerDown() {
  if (playerList.lastChild.id === document.activeElement.parentNode.id)
    return;

  var source = document.getElementById(document.activeElement.parentNode.id);
  var clone = deepClone(source.nextSibling);
  playerList.replaceChild(source, source.nextSibling)  
  playerList.insertBefore(clone, source);
}

function submitGetMemberName(memberID, callback) {
  $.ajax({
    url: '/console/getMemberName?memberID=' + memberID,
    type: 'get',
    dataType: 'json',
    success: function(responsedata) {
      callback(responsedata.member.name);
    }
  });
}

function submitPinFinishPractice() {
  $.ajax({
      url: '/console/endPractice?lane=' + lane,
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        removeAnchorFromUrl();
      }
  });
}

function checkMember(x) {
  var memberID = x.value.trim();
  const isAllDigits = /^\d+$/.test(memberID);
  
  if (isAllDigits) {
    submitGetMemberName(memberID, function(name) {
      x.value = name;
      // The member database is free text an operator typed, and this runs on blur - so the
      // box is not the focused element and the oninput filter cannot see it. Passing the
      // element is what makes the rule apply to a name that arrived this way. The slave
      // sanitises it too; this is so the box shows what the start will actually store.
      adjustCaps(x);
    });
  }
}

function AddAMRplayer(player, section, index) {
  var shallPlayLeft = player === null ? 0 : Number(player.shallPlayLeft);

  // Create the left radio button
  var radioLeft = document.createElement("input");
  radioLeft.type = "radio";
  radioLeft.name = "leftGroup"; // Ensure the name groups all left radios together
  radioLeft.id = "left" + index;
  radioLeft.style.display = "none"; // Hide the radio button

  // Create label for the left radio button with image
  var leftLabel = document.createElement("label");
  leftLabel.setAttribute("for", radioLeft.id);
  var leftImage = document.createElement("img");
  leftImage.src = "../common/img/LeftArrow.png"; // Default left arrow image
  leftImage.classList.add("radio-img"); // Add a class for custom styling
  leftLabel.appendChild(leftImage);

  // Create text field for player name
  var Spelarnamn = document.createElement("input");
  Spelarnamn.type = "text";
  Spelarnamn.style.width = "70%";
  Spelarnamn.style.margin = "1%";
  Spelarnamn.value = player === null ? "" : player.name;
  Spelarnamn.readOnly = true;

  // Create the right radio button
  var radioRight = document.createElement("input");
  radioRight.type = "radio";
  radioRight.name = "rightGroup"; // Ensure the name groups all right radios together
  radioRight.id = "right" + index;
  radioRight.style.display = "none"; // Hide the radio button

  // Create label for the right radio button with image
  var rightLabel = document.createElement("label");
  rightLabel.setAttribute("for", radioRight.id);
  var rightImage = document.createElement("img");
  rightImage.src = "../common/img/RightArrow.png"; // Default right arrow image
  rightImage.classList.add("radio-img"); // Add a class for custom styling
  rightLabel.appendChild(rightImage);

  // Append elements based on shallPlayLeft
  if (shallPlayLeft) {
    section.appendChild(radioLeft);
    section.appendChild(leftLabel); // Append the image label
  }
  
  section.appendChild(Spelarnamn);
  
  if (!shallPlayLeft) {
    section.appendChild(radioRight);
    section.appendChild(rightLabel); // Append the image label
  }

  // Add a line break after each player entry
  section.appendChild(document.createElement("br"));

  // Add event listeners to handle the grayscale/color transition
  radioLeft.addEventListener('change', updateImages);
  radioRight.addEventListener('change', updateImages);
}

function AMRsetActivePlayers() {
  for (var i = 0; i < 16; i++) {
    var radioName = "left" + i;
    var radioButton = document.getElementById(radioName);
    if (radioButton) {
      radioButton.checked = false;
      // Set the image for the left radio button to grayscale
      var imgElement = document.querySelector(`label[for="${radioName}"] img`);
      if (imgElement) {
        imgElement.src = "../common/img/LeftArrow.png"; // Set default image
        imgElement.style.filter = "grayscale(100%)"; // Grayscale when not selected
      }
    }

    radioName = "right" + i;
    radioButton = document.getElementById(radioName);
    if (radioButton) {
      radioButton.checked = false;
      // Set the image for the right radio button to grayscale
      var imgElement = document.querySelector(`label[for="${radioName}"] img`);
      if (imgElement) {
        imgElement.src = "../common/img/RightArrow.png"; // Set default image
        imgElement.style.filter = "grayscale(100%)"; // Grayscale when not selected
      }
    }
  }

  // Set the active player for the left lane
  if (activePlayerLeft >= 0) {
    var radioName = "left" + activePlayerLeft;
    var radioButton = document.getElementById(radioName);
    if (radioButton) {
      radioButton.checked = true;
      // Set the image for the active left player to full color
      var imgElement = document.querySelector(`label[for="${radioName}"] img`);
      if (imgElement) {
        imgElement.src = "../common/img/LeftArrow.png"; // Left arrow image
        imgElement.style.filter = "none"; // Full color when selected
      }
    }
  }

  // Set the active player for the right lane
  if (activePlayerRight >= 0) {
    var radioName = "right" + activePlayerRight;
    var radioButton = document.getElementById(radioName);
    if (radioButton) {
      radioButton.checked = true;
      // Set the image for the active right player to full color
      var imgElement = document.querySelector(`label[for="${radioName}"] img`);
      if (imgElement) {
        imgElement.src = "../common/img/RightArrow.png"; // Right arrow image
        imgElement.style.filter = "none"; // Full color when selected
      }
    }
  }
}

function AMRsubmitActiveChange() {
  var activePlayerOdd = -1;
  var activePlayerEven = -1;

  for (var i= 0; i<16; i++)
  {
    var radioName = "left" + i;
    var radioButton = document.getElementById(radioName);
    if (radioButton && radioButton.checked) activePlayerOdd = i;

    radioName = "right" + i;
    radioButton = document.getElementById(radioName);
    if (radioButton && radioButton.checked) activePlayerEven = i;
  }

  $.ajax({
    url: '/console/AMRsetActivePlayer',
    type: 'get',
    dataType: 'json',
    data: {
        lane: lane,
        activePlayerOdd: activePlayerOdd,
        activePlayerEven: activePlayerEven
    },
    success: function(responsedata) {
        removeAnchorFromUrl();
    }
  });
}

function AMRinitializePlayerList() {
  var oddLane = document.getElementById("oddLane");
  var evenLane = document.getElementById("evenLane");
  var laneNumber = Number(lane);
  var leftLane = laneNumber % 2 ? laneNumber : laneNumber - 1;
  var rightLane = laneNumber % 2 ? laneNumber + 1 : laneNumber;
  var leftLaneRequest = $.getJSON('/console/players.json?lane=' + leftLane);
  var rightLaneRequest = $.getJSON('/console/players.json?lane=' + rightLane);

  $.when(leftLaneRequest, rightLaneRequest).done(function(leftData, rightData) {
    var leftResponse = leftData[0];
    var rightResponse = rightData[0];

    activePlayerLeft = Number(leftResponse.activePlayer);
    oddLane.innerHTML = '';
    for (var i = 0; i < leftResponse.players.length; i++) {
      var player = leftResponse.players[i];
      AddAMRplayer(player, oddLane, i);
    }

    activePlayerRight = Number(rightResponse.activePlayer);
    evenLane.innerHTML = '';
    for (var i = 8; i < (rightResponse.players.length + 8); i++) {
      var player = rightResponse.players[i - 8];
      AddAMRplayer(player, evenLane, i);
    }

    AMRsetActivePlayers();
  });
}

function updateImages() {
  // Handle left group (all radios in the "leftGroup")
  var leftRadios = document.querySelectorAll('input[name="leftGroup"]');
  leftRadios.forEach(function(radio) {
    var label = document.querySelector('label[for="' + radio.id + '"] img');
    if (radio.checked) {
      label.style.filter = 'none'; // Color image for checked radio
    } else {
      label.style.filter = 'grayscale(100%)'; // Grayscale for unchecked radios
    }
  });

  // Handle right group (all radios in the "rightGroup")
  var rightRadios = document.querySelectorAll('input[name="rightGroup"]');
  rightRadios.forEach(function(radio) {
    var label = document.querySelector('label[for="' + radio.id + '"] img');
    if (radio.checked) {
      label.style.filter = 'none'; // Color image for checked radio
    } else {
      label.style.filter = 'grayscale(100%)'; // Grayscale for unchecked radios
    }
  });
}

$(function() {
$("#changePlayerButton").click(updatePlayerInfo);
$("#changePlayerInfoSubmitButton").click(submitChangePlayerInfoForm);
$("#addplayerbutton").click(addPlayerAction);
$("#stopBowlingsubmitbutton").click(submitStopBowling);
$("#callPersonalButton").click(resetCallPersonalForm);
$("#stopBowlingbutton").click(resetstopBowlingForm);
$("#callPersonalsubmitbutton").click(submitcallPersonalsubmit);
$("#pinResetSubmitbutton").click(submitPinResetLane);
$("#pinSetSubmitbutton").click(submitPinSetLane);
$("#pinSetExtraButton").click(submitPinSetLane);
$("#stopPracticeSubmitbutton").click(submitPinFinishPractice);
$("#pinSetterButton").click(fetchLastPlayedPinPattern);
$("#AMRchangeActivePlayerButton").click(AMRinitializePlayerList);
$("#AMRchangeActiveSaveButton").click(AMRsubmitActiveChange);
});
