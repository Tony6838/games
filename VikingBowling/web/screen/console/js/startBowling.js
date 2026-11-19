var startButton = document.getElementById("startBowling");
var startTrainingButton = document.getElementById("startTraning");
var pins = document.getElementById("trainingFormRight").querySelectorAll("input");
var trainers = document.getElementById("trainingFormLeft").querySelectorAll(".playerName");
var trainingMethods = document.getElementById("trainingFormLeft").querySelectorAll(".show-tick");
var players = document.getElementById("bowlingStartForm").querySelectorAll(".playerName");
var trainingMethods = document.getElementById("trainingFormLeft").querySelectorAll("select");

// The handicap box beside each name (.playerHcp): HCP per game, which the lane adds to the
// bowler's total for every game, as for an HCP typed in the reception's F2. Optional - empty is
// no handicap, exactly what a start had before the box. The highest a guest can type is a game's
// own 300 (CONSOLE_HCP_MAX in LoadCom's LoadComWebInterface.cpp, which is the boundary and
// checks it again). This file is the same in web\screen\console\js and web\screen\HTML\console\js:
// change the two copies and LoadCom's number together.
var VBS_HCP_MAX = 300;

// oninput of a handicap box: digits only and never above VBS_HCP_MAX, so the box shows what the
// start will send. Our own on-screen keyboard (vbskeyboard.js) types into it like into a name, and
// its letter keys are refused here. A value above the maximum is cut back to it rather than
// emptied, so a guest who hit one digit too many sees the limit instead of losing the number.
// The box is type="text", not "number": vbskeyboard.js serves only text fields.
function adjustHcp(el) {
  if (el && typeof el.value !== "string" && el.target) el = el.target;
  if (!el || typeof el.value !== "string") return;
  var digits = el.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  if (digits !== "" && parseInt(digits, 10) > VBS_HCP_MAX) digits = String(VBS_HCP_MAX);
  if (digits !== el.value) el.value = digits;
}

// What startBowling sends for the box in row i: a whole number above 0, or "" for none. A form
// without the boxes (its HTML cached from before them) sends none.
function vbsHcpOfRow(hcps, i) {
  if (!hcps || i >= hcps.length) return "";
  var n = parseInt(String(hcps[i].value).replace(/[^0-9]/g, ""), 10);
  if (isNaN(n) || n <= 0) return "";
  return String(Math.min(n, VBS_HCP_MAX));
}

function submitStartBowling() {
  var bumps = document.getElementById("bowlingStartForm").querySelectorAll(".playerBump");
  var hcps = document.getElementById("bowlingStartForm").querySelectorAll(".playerHcp");
  // encodeURIComponent, not the %20 substitution this used to end with: a name may contain
  // & or + - see the same reasoning on vbsSendPendingNames below - and replacing only the
  // spaces left every other delimiter to be read as one. playMethod is encoded for the
  // opposite reason: it DOES hold spaces ("Starta Amerikanskt L\u00f6sspel") and was relying on
  // that substitution to carry them.
  var formdata = "playMethod=" + encodeURIComponent(startButton.innerHTML);
  var playerID = 0;

  // Only the rows the form shows ("Antal spelarfält" below): a hidden row is emptied when it is
  // hidden, but a member-number lookup still on its way can write a name into it afterwards.
  for (var i=0; i<players.length && i<vbsMaxPlayers; i++)
  {
    if (players[i].value.trim().length > 0)
    {
      formdata += "&player" + playerID + "=" + encodeURIComponent(players[i].value.trim());
      if (bumps[i].checked)
        formdata += "plusCCC";

      // The handicap goes with the name it was typed beside, under the same packed number - an
      // empty row before it moves both down together. None is sent for no handicap, so a start
      // without one is the request it always was; an older slave ignores the parameter.
      var hcp = vbsHcpOfRow(hcps, i);
      if (hcp !== "")
        formdata += "&hcp" + playerID + "=" + hcp;

      playerID++;
    }
  }  

  // Nobody to bowl: no request. The button is off without a name, so this is only the guard
  // behind it; LoadCom refuses such a start too ("noPlayers"). A game with no players ends the
  // moment it starts and the lane goes back to its waiting screen.
  if (playerID === 0) {
    checkNameValid();
    return;
  }

  // The press itself, for the lane TV's mirrored start button: it shows pressed until the
  // started game takes the name boxes off the screen - or until one of the paths below says
  // the start did not happen and puts the form's state back.
  vbsSendStartPressed();

  $.ajax({
      url: '/console/startBowling?lane=' + getLane(),
      type: 'get',
      dataType: 'json',
      data: formdata,
      success: function(responsedata) {
        if (responsedata && responsedata.success === "false" && responsedata.reason === "partnerBusy") {
          // The slave refused the start: American play writes both lanes of the pair and the
          // partner lane is in use (another booking, training, a competition - see
          // StartNewGame in LoadCom). The names stay in the form so the guest can start an
          // ordinary game with them instead. An older slave never sends these fields.
          alert(partnerBusyMessage(responsedata.partnerLane));

          // No game is coming, so the TV's mirrored start button has to come back up.
          vbsSendPendingNames(true);
          return;
        }
        $("#startBowlingForm")[0].reset();
        // reset() empties the names but leaves the button as it was - on, since a name had
        // been typed - and nothing turns it off again before the page is reloaded. The next
        // guests then started a game with no players by pressing Start on the empty form.
        checkNameValid();
        removeAnchorFromUrl();
      },
      error: function () {
        // The slave never answered, or refused a start without names (400 "noPlayers", which
        // the guard above keeps this page from sending). The form is still open - same as the
        // refusal above - and the button follows the names again.
        vbsSendPendingNames(true);
        checkNameValid();
      }
  });
}
// In the lane's own language, like the texts in TouchConsole.js; lang is set there from the
// lane status payload. Same wording shape as the V3 console's IDS_LANE_NOT_OPEN.
function partnerBusyMessage(partnerLane) {
  switch ((typeof lang === "string" ? lang : "english").toLowerCase()) {
    case "svenska":  return "Bana " + partnerLane + " är upptagen.\nAmerikanskt spel kan inte startas nu.\n- Kontakta personalen";
    case "suomeksi": return "Rata " + partnerLane + " on varattu.\nAmerikkalaista peliä ei voi aloittaa nyt.\n- Ota yhteys henkilökuntaan";
    case "deutsch":  return "Bahn " + partnerLane + " ist belegt.\nAmerikanisches Spiel kann jetzt nicht gestartet werden.\n- Bitte das Personal kontaktieren";
    case "dansk":    return "Bane " + partnerLane + " er optaget.\nAmerikansk spil kan ikke startes nu.\n- Kontakt personalet";
    case "norsk":    return "Bane " + partnerLane + " er opptatt.\nAmerikansk spill kan ikke startes nå.\n- Kontakt personalet";
    default:         return "Lane " + partnerLane + " is busy.\nAmerican play cannot be started now.\n- Please contact the staff";
  }
}
function getPinPosition(UIposition) {
  UIposition %= 10;
  switch(UIposition) {
    case 0:
      return 6;
    case 1:
      return 7;
    case 2:
      return 8;
    case 3:
      return 9;    
    case 4:
      return 3;
    case 5:
      return 4;    
    case 6:
      return 5;
    case 7:
      return 1;      
    case 8:
      return 2;
    case 9:
      return 0;      
  }  
}
function submitStartTraining() {
  var trainerID = 0;
  var formdata = "playMethod=training";

  for (var i=0; i<trainers.length; i++)
  {
    if (trainers[i].value.trim().length > 0)
    {
      formdata += "&player" + trainerID + "=" + encodeURIComponent(trainers[i].value.trim());

      var trainIndex = trainingMethods[i].selectedIndex;
      formdata += "&trainName" + trainerID + "=" + encodeURIComponent(trainingMethods[i].options[trainIndex].text);

      if (trainingMethods[i].selectedIndex == 0)
      {
        formdata += "&pins" + trainerID + "=";

        var PinPattern = 0;
        for (var j=0; j<10; j++)
          if (pins[i * 10 + j].checked) PinPattern += 1 << getPinPosition(i * 10 + j);

        formdata += PinPattern;
      }

      trainerID++;
    }
  }  
  formdata += "&totalTrainers=" + trainerID;

  $.ajax({
      url: '/console/startTraining?lane=' + getLane(),
      type: 'get',
      dataType: 'json',
      data: formdata,
      success: function(responsedata) {
        $("#startTrainingForm")[0].reset();
        // As for the bowling form: reset() leaves the button on. LoadCom refuses a training
        // without trainers, so here it only spares the guest a press that does nothing.
        checkTrainingValid();
        removeAnchorFromUrl();
      }
  });
}
function submitPressSpace() {
  var formdata;
  $.ajax({
      url: '/console/pressSpace?lane=' + getLane(),
      type: 'get',
      dataType: 'json',
      data: formdata,
      success: function(responsedata) {
      }
  });
}
function getTrainingNames(x) {
  // The bowling form's start button is left alone: its caption is the game type the bowling
  // form sends as playMethod, and the training form has a start button of its own
  // (#startTraning). This used to write "Starta GSX Träning" on it, so the bowling form the
  // lane opened after a training showed that caption and, since LoadCom knows no such game
  // type, started plain open play instead of the game type chosen before.
  window.open("#fillTrainingData", "_self");

  clearTrainingPins();
  
  $.getJSON('/console/getTrainingNames.json?lane=' + getLane(), function( data ) {
    for (var i=0; i<trainingMethods.length; i++)
    {
      $(trainingMethods[i]).empty();

      var fastPattern = "Fast Kägeluppställning ------>";
      var option = document.createElement("OPTION");
      option.setAttribute("class", "btn btn-primary btn-lg btn-block lookUpName");
      option.setAttribute("value", fastPattern);
      option.innerHTML = fastPattern;
      trainingMethods[i].appendChild(option);

      for (var j=0; j<data.trainings.length; j++)
      {
        var option = document.createElement("OPTION");
        option.setAttribute("class", "btn btn-primary btn-lg btn-block lookUpName");
        option.setAttribute("value", data.trainings[i]);
        option.innerHTML = data.trainings[j];
        trainingMethods[i].appendChild(option);
      }
    }
  });
}
function hideBowlingMenuForm() {
  $("#fillBowlingData").hide();
}
function showBowlingMenuForm() {
  checkNameValid();
  window.open("#fillBowlingData", "_self");
  $("#fillBowlingData").show();
}
function checkNameValid() {
  startButton.disabled = true;

  for (var i=0; i<players.length && i<vbsMaxPlayers; i++)
  {
    if (players[i].value.trim().length > 0)
    {
      startButton.disabled = false;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// "Antal spelarfält" - how many of the form's six name rows are shown.
//
// Set in the reception's Terminalinställningar (registry WebConsolePlayers on the slave) and sent
// in the lane status payload as WebMaxPlayers, 1-6; TouchConsole.js (HtmlConsole.js in the HTML
// console) hands it here when it changes. The six rows stay in the page: submitStartBowling, the
// live names for the lane TV and both keyboards' Next walk the same fields, and a hidden row takes
// no part - it is emptied as it is hidden, and the keyboards skip a field that is not laid out.
// Absent (an older slave) or anything but 1-6 is all six rows, the form as it was before.
//
// For a test without a slave, ?players=<n> on the page's address does the same, until a payload
// says otherwise (testtools/webui/console_fit.mjs measures each n that way).
//
// This file is the same in web\screen\console\js and web\screen\HTML\console\js: change both.
// ---------------------------------------------------------------------------
var VBS_NAME_ROWS = 6;
var vbsMaxPlayers = VBS_NAME_ROWS;

function vbsMaxPlayersFrom(value) {
  var n = parseInt(value, 10);
  return (isNaN(n) || n < 1 || n > VBS_NAME_ROWS) ? VBS_NAME_ROWS : n;
}

// The element holding one row's name, handicap and bumper box: .nameRow in the new layout, the
// <p> around the three fields in the HTML console.
function vbsNameRowOf(input) {
  return input.closest('.nameRow') || input.parentNode;
}

function vbsApplyMaxPlayers(value) {
  var n = vbsMaxPlayersFrom(value);
  var form = document.getElementById("bowlingStartForm");
  var bumps = form.querySelectorAll(".playerBump");
  var hcps = form.querySelectorAll(".playerHcp");
  vbsMaxPlayers = n;
  for (var i = 0; i < players.length; i++) {
    var hide = i >= n;
    if (hide) {
      // Emptied BEFORE the blur: the name field's onblur (checkMember) looks up a member number
      // it still holds and writes the name back. The senders below also stop at vbsMaxPlayers,
      // for a lookup that was already on its way.
      players[i].value = "";
      if (i < hcps.length) hcps[i].value = "";
      if (i < bumps.length) bumps[i].checked = false;
      if (document.activeElement === players[i] || (i < hcps.length && document.activeElement === hcps[i]))
        document.activeElement.blur();
    }
    var row = vbsNameRowOf(players[i]);
    if (row) row.style.display = hide ? "none" : "";
  }
  checkNameValid();
  vbsQueuePendingNames();
}

// How many bowlers "Ändra spelare" may build the list up to: the form's rows when the hall has
// chosen fewer than six, else the eight a lane holds, as before the setting. Bowlers already on the
// lane are never taken off - a game the reception started with more keeps them.
function vbsChangePlayersMax() {
  return vbsMaxPlayers < VBS_NAME_ROWS ? vbsMaxPlayers : 8;
}

function clearTrainingPins() {
  for (var j=0; j<pins.length; j++)
    pins[j].checked = false;
}
function updateTrainingPINsActive() {
  for (var j=0; j<pins.length; j++)
    if (trainingMethods[parseInt(j/10)].selectedIndex > 0)
    {
      pins[j].checked = false;
      pins[j].disabled = true;
    }
    else
      pins[j].disabled = false;

  checkTrainingValid();
}
function checkTrainingValid() {
  startTrainingButton.disabled = true;

  for (var i=0; i<trainers.length; i++)
  {
    if (trainers[i].value.trim().length > 0)
    {
      if (trainingMethods[i].selectedIndex > 0)
      {
        startTrainingButton.disabled = false;
        return;
      }
      else
      {
        for (var j=0; j<pins.length; j++)
          if (pins[j].checked)
          {
            startTrainingButton.disabled = false;
            return;
          }
      }
    }
  }
}
function selectBowling(x) {
  startButton.innerHTML = x.value;
  // The button follows the names as the form opens, whatever happened to it since.
  checkNameValid();
  window.open("#fillBowlingData", "_self");
}
function initializeBowlingSelectForm() {
  closeNoTapDetails();
  checkIfMoveFileExists();
}
function closeNoTapDetails() {
  document.getElementById("NoTapDetails").open = false;
}
$(function() {
$("#startBowling").click(submitStartBowling);
$("#startTraning").click(submitStartTraining);
$("#pressSpace").click(submitPressSpace);
});

// ---------------------------------------------------------------------------
// Live player names, for the lane TV.
//
// While the "Fyll i spelarnamn" form is open, the six name fields are sent to
// the slave as they are typed so the lane TV can show them being entered - the
// same six boxes it shows when somebody is typing on the V3 console at the lane
// instead. The slave holds them per lane and puts them in the lane status
// payload; see LoadComWebService_Console::setPendingNames in
// Slave/LOADCOM/LoadComWebInterface.cpp and vbsnameentry.js on the TV.
//
// Nothing here changes what the form does. The names are not a game and are not
// lane data: submitStartBowling above is still the only thing that starts one,
// and it still sends exactly what it always did.
//
// An older slave has no such function registered and answers 501. That is why
// this is fire and forget with its own empty error handler - a console must go
// on working against a slave that has not been updated yet, and there is
// nothing to tell the operator in any case.
// ---------------------------------------------------------------------------

// Debounce. The slave's event pump republishes at 4 Hz, so sending faster than
// this could not reach a screen any sooner; it only turns each keystroke into
// its own HTTP request.
var VBS_PENDING_NAMES_DEBOUNCE_MS = 150;

var vbsPendingNamesTimer = null;
var vbsPendingNamesSent = null;

// Whether this page is the one currently filling the lane's slot. Read only by the
// guard at the top of vbsSendPendingNames, which is where it matters.
var vbsPendingNamesOwned = false;

// The form's bumper checkboxes as the slave spells them: one character per
// name field, '1' ticked. This form has a checkbox beside every name, so it is
// always sent and the TV always draws the column for it. An older slave
// ignores the parameter.
function vbsPendingBumpersParam() {
  var bumps = document.getElementById("bowlingStartForm").querySelectorAll(".playerBump");
  var ticked = '';
  for (var i = 0; i < players.length; i++) {
    ticked += (i < vbsMaxPlayers && i < bumps.length && bumps[i].checked) ? '1' : '0';
  }
  return '&bumpers=' + ticked;
}

// How many boxes the TV is to draw, said only when the form shows fewer than all six ("Antal
// spelarfält" above). An older slave ignores the parameter and draws six.
function vbsPendingRowsParam() {
  return vbsMaxPlayers < VBS_NAME_ROWS ? '&rows=' + vbsMaxPlayers : '';
}

function vbsBowlingFormIsOpen() {
  // The form is a CSS :target overlay, so the hash is what opens and closes it -
  // and it is the one test that catches every way out, including the browser
  // back button and the close links, without having to hook each of them.
  return window.location.hash === '#fillBowlingData';
}

function vbsSendPendingNames(active) {
  // Never clear a slot this page did not fill. The V3 console at the lane writes the
  // same one, and a clear is sent on any hashchange - including the one this page does
  // to itself on load - so without this, simply opening the web console for a lane would
  // wipe the names a guest was in the middle of typing at the lane itself.
  if (!active && !vbsPendingNamesOwned) return;

  var query = '/console/setPendingNames?lane=' + getLane();

  if (!active) {
    query += '&active=0';
  }
  else {
    for (var i = 0; i < players.length; i++) {
      // Empty fields are sent too, unlike in submitStartBowling which stops at
      // the first blank: these are drawn as six boxes on the TV, so the third
      // name has to stay in the third box when the second one is cleared.
      // encodeURIComponent, as every builder on this page now does. This endpoint
      // was the first: a name may contain & or +, and replacing only the spaces -
      // which is what the whole page used to do - left every other delimiter to be
      // read as one. A row the form does not show is sent empty ("Antal spelarfält").
      query += '&player' + i + '=' + encodeURIComponent(i < vbsMaxPlayers ? players[i].value.trim() : '');
    }

    // The bumper checkbox beside each name, so the TV draws its column too, and as many boxes as
    // the form shows.
    query += vbsPendingBumpersParam() + vbsPendingRowsParam();

    // This page's own cursor, so the TV can draw one in the box being typed in:
    // the index of the focused name field and its caret's column. The column is
    // given against the trimmed name sent above, so a leading space the field
    // still holds does not push the TV's cursor one step right. No field
    // focused - the keyboard was dismissed - sends neither, and the TV then
    // shows no cursor; an older slave ignores both parameters.
    for (var f = 0; f < players.length; f++) {
      if (document.activeElement !== players[f]) continue;
      var raw = players[f].value;
      var lead = raw.length - raw.replace(/^\s+/, '').length;
      var selStart = players[f].selectionStart === null ? raw.length : players[f].selectionStart;
      var selEnd = players[f].selectionEnd === null ? raw.length : players[f].selectionEnd;

      // Text selected - the field selects on focus, so the next key replaces
      // the name - is the state the V3 console shows as inverse video, and the
      // TV highlights the name instead of drawing a caret. The caret is then
      // reported at the selection's end, where it lands when the selection
      // collapses - and all an older slave, which ignores sel, can draw.
      var selected = selEnd !== selStart && raw.trim().length > 0;
      var caret = Math.max(0, Math.min((selected ? selEnd : selStart) - lead, raw.trim().length));
      query += '&focus=' + f + '&caret=' + caret;
      if (selected) query += '&sel=1';
      break;
    }
  }

  // Nothing changed since the last send - a modifier key that moved nothing, a
  // second close of an already closed form. The caret is part of the query, so
  // a keypress that only moved it counts as a change now.
  if (query === vbsPendingNamesSent) return;
  vbsPendingNamesSent = query;
  vbsPendingNamesOwned = active;

  $.ajax({ url: query, type: 'get', dataType: 'json', error: function () {} });
}

// The start button's own press, sent at once: the lane TV shows its mirrored
// button pressed until the started game takes the boxes off the screen - or
// until submitStartBowling, on a start that did not happen, puts them back.
// Skips the debounce because the press must not lose its race against the game
// start that follows it, but never touches a slot this page did not fill, for
// the reason vbsSendPendingNames never clears one.
function vbsSendStartPressed() {
  if (!vbsPendingNamesOwned) return;
  window.clearTimeout(vbsPendingNamesTimer);

  // start=2 is "pressed" (1 would be "highlighted", which the V3 console's keyboard focus has
  // and a tap on a web page does not).
  var query = '/console/setPendingNames?lane=' + getLane() + '&start=2';
  for (var i = 0; i < players.length; i++) {
    query += '&player' + i + '=' + encodeURIComponent(i < vbsMaxPlayers ? players[i].value.trim() : '');
  }
  query += vbsPendingBumpersParam() + vbsPendingRowsParam();

  vbsPendingNamesSent = query;
  $.ajax({ url: query, type: 'get', dataType: 'json', error: function () {} });
}

function vbsQueuePendingNames() {
  if (!vbsBowlingFormIsOpen()) return;

  window.clearTimeout(vbsPendingNamesTimer);
  vbsPendingNamesTimer = window.setTimeout(function () {
    vbsSendPendingNames(true);
  }, VBS_PENDING_NAMES_DEBOUNCE_MS);
}

function vbsFollowBowlingForm() {
  window.clearTimeout(vbsPendingNamesTimer);

  // Opening the form publishes it straight away, empty fields and all, so the
  // TV puts up six boxes the moment a guest starts - rather than only once the
  // first letter is typed. Closing it clears them; that is what takes the boxes
  // off the TV when the dialog is dismissed or a game is started.
  vbsSendPendingNames(vbsBowlingFormIsOpen());
}

$(function () {
  for (var i = 0; i < players.length; i++) {
    // 'input' and not the 'onkeyup' the fields already carry: keyup misses a
    // paste, a touch keyboard and the member lookup that fills a name in. The
    // inline oninput="adjustCaps()" was registered when the element was parsed
    // and therefore runs before this, so what is sent is the capitalised name
    // the field ends up showing.
    players[i].addEventListener('input', vbsQueuePendingNames);

    // The Start button follows the names on the same event, for the same reason: the inline
    // onkeyup="checkNameValid()" misses a paste, a keyboard suggestion and autofill, and since
    // the button is turned off again after every start, a name filled in that way would leave
    // it off.
    players[i].addEventListener('input', checkNameValid);

    // The cursor can move with no name changing - a tap into another field, an
    // arrow key, a tap inside a name - and the TV's cursor has to follow.
    // keyup and mouseup rather than their down twins, so selectionStart is read
    // after the move; the 150 ms debounce coalesces the blur/focus pair a move
    // between fields fires. The send itself dedupes, so an event that moved
    // nothing costs no request.
    players[i].addEventListener('focus', vbsQueuePendingNames);
    players[i].addEventListener('blur', vbsQueuePendingNames);
    players[i].addEventListener('keyup', vbsQueuePendingNames);
    players[i].addEventListener('mouseup', vbsQueuePendingNames);
    players[i].addEventListener('touchend', vbsQueuePendingNames);

    // A selection can change with none of the above firing usefully - the
    // select-on-focus, a double-tap that selects a word - and the TV's
    // highlight has to follow. The send dedupes, so a no-change event is free.
    players[i].addEventListener('select', vbsQueuePendingNames);
  }

  // The training form's names likewise (onkeyup="checkTrainingValid()"), whose button is
  // turned off again after every training start too.
  for (var t = 0; t < trainers.length; t++) {
    trainers[t].addEventListener('input', checkTrainingValid);
  }

  // A bumper ticked or unticked changes the TV's column. The send dedupes.
  var bumps = document.getElementById("bowlingStartForm").querySelectorAll(".playerBump");
  for (var b = 0; b < bumps.length; b++) {
    bumps[b].addEventListener('change', vbsQueuePendingNames);
  }

  window.addEventListener('hashchange', vbsFollowBowlingForm);

  // A test's ?players=<n> ("Antal spelarfält" above), before the form is first published.
  var askedRows = new URLSearchParams(window.location.search).get('players');
  if (askedRows !== null) vbsApplyMaxPlayers(askedRows);

  // In case the console was opened straight onto the form.
  vbsFollowBowlingForm();
});
