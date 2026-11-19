var focusedCell = -1;
var lastValidCell = -1;
var scoreRows = document.getElementById("scorerow");
// Whose balls the form holds, from the read that filled it; sent back with the correction so that
// the slave can refuse it if that row holds somebody else by then, or if balls have been thrown.
var scoreOfPlayerId, scoreOfGame, scoreOfSquare;

  function updatePlayersScore() {
    showChangeScoreForm();
    $.getJSON('/console/players.json?lane=' + getLane(), function (data) {
        $('#playerlistforchange').html('');
        $('#playerlistforchange').append('<select onchange="fillPlayerScore()" id="selectplayerlistforchange" class="show-tick lookUpName" name="playerindex">');
        for (var i = 0; i < data.players.length; i++) {
            var player = data.players[i];
            $("#selectplayerlistforchange").append('<option class="btn btn-primary btn-lg btn-block lookUpName" value="' + player.index + '">' + player.name + '</option>');
        }
        activePlayer = data.activePlayer % 8;
        const select = document.getElementById("selectplayerlistforchange");
        select.selectedIndex = activePlayer;
        select.focus(); 
        fillPlayerScore();
    });
  }

  function fillPlayerScore() {
    loseFocus();
    focusedCell = -1;
    var player = document.getElementById("selectplayerlistforchange");
    var urltext = '/console/playerScore.json?lane=' + getLane() + '&playerIndex=' + player.selectedIndex;

      $.getJSON(urltext, function (data) {
        scoreOfPlayerId = data.playerIdNumber;
        scoreOfGame = data.activeGame;
        scoreOfSquare = data.activeSquare;
        var playedScore = 0;
        for (var i=0; i < data.scores.length; i++)
        {
          scoreTable[i] = data.scores[i];
          
          if (data.scores[i] >= 0)
          {
            scoreRows.cells[i].innerHTML = getSpecialBowlChar(i, data.scores[i]);
            scoreRows.cells[i].style.backgroundColor = "white";
            scoreRows.cells[i].setAttribute("tabindex", "0");
            playedScore++;
          }
          else
          {
            scoreRows.cells[i].innerHTML = '';
            scoreRows.cells[i].style.backgroundColor = "lightgray";
            scoreRows.cells[i].removeAttribute("tabindex");
          }
        }
        lastValidCell = focusedCell = playedScore - 1;
      });

      getFocus();
  }	 
function addPlayerScore() {
  if (lastValidCell >= 20) return;

  loseFocus();
  focusedCell = ++lastValidCell;
  scoreRows.cells[lastValidCell].style.backgroundColor = "white";       
  scoreRows.cells[lastValidCell].setAttribute("tabindex", "0");
  scoreRows.cells[lastValidCell].innerHTML = getSpecialBowlChar(lastValidCell, 0);
  scoreTable[lastValidCell] = 0;
  getFocus();
}
function deletePlayerScore() {
  if (lastValidCell < 0) return;

  loseFocus();
  scoreRows.cells[lastValidCell].innerHTML = "";
  scoreRows.cells[lastValidCell].style.backgroundColor = "lightgray";
  scoreRows.cells[lastValidCell].removeAttribute("tabindex");
  scoreTable[lastValidCell] = -1;
  focusedCell = --lastValidCell;
  getFocus();
}
function getFocus() {
  if (focusedCell < 0) return;
  scoreRows.cells[focusedCell].classList.add("focusedTabelCell");
} 
function loseFocus() {
  if (focusedCell < 0) return;
  var x = document.getElementById("correctButtons").querySelectorAll("button"); 
  for (var i=0; i<x.length; i++) x[i].disabled = false;  
  
  scoreRows.cells[focusedCell].classList.remove("focusedTabelCell");
} 
function setScore(score) {
  if (focusedCell < 0) return;
  if (scoreRows.cells[focusedCell].style.backgroundColor === "lightgray") return;
  
  scoreRows.cells[focusedCell].innerHTML = score;

  if (score === "X" && focusedCell < 17)
  {
    scoreRows.cells[focusedCell + 1].innerHTML = "";
    scoreTable[focusedCell + 1] = 0;
  }
    
  switch(score) {
    case "":
    case "-":
      scoreTable[focusedCell] = 0;
      break;      
    case "F":
      scoreTable[focusedCell] = 'F';
      break;
    case "X":
      scoreTable[focusedCell] = 10;
      break;
    case "/":
      scoreTable[focusedCell] = 10 - scoreTable[focusedCell - 1];
      break;      
    default:
      var isSpar = false;
      if ((focusedCell % 2 === 0) && scoreTable[focusedCell] + scoreTable[focusedCell + 1] == 10 && scoreTable[focusedCell] < 10)
        isSpar = true;

      scoreTable[focusedCell] = score;

      if (isSpar) scoreTable[focusedCell + 1] = 10 - scoreTable[focusedCell];
      break;
  }

  if (isFirstThrow(focusedCell))
    scoreRows.cells[focusedCell + 1].innerHTML = getSpecialBowlChar(focusedCell + 1, scoreTable[focusedCell + 1]);

  updateCorrectButtons();
}    
function resetPlayerScore() {
  document.getElementById("playerNameToChange").value = "";
  updatePlayersScore();
}    
function submitChangeScoreForm() {
  var formdata = $('#changescoreform').serialize();

  var select = document.getElementById("selectplayerlistforchange");
  var namelist = select.getElementsByTagName("option");

  formdata += "&name=" + namelist[select.selectedIndex].text;
  formdata += "&scores=" + scoreTable;
  if (scoreOfPlayerId !== undefined) formdata += "&playerid=" + scoreOfPlayerId;
  if (scoreOfGame !== undefined) formdata += "&game=" + scoreOfGame;
  if (scoreOfSquare !== undefined) formdata += "&square=" + scoreOfSquare;
  formdata = formdata.trim().replace(/ /g, "%20");

  $.ajax({
      url: '/console/changeScore?lane=' + getLane(),
      type: 'get',
      dataType: 'json',
      data: formdata,
      success: function(responsedata) {
        if (responsedata && responsedata.success === "false" && responsedata.reason === "laneMovedOn") {
          // The lane plays another game than this form was filled from: nothing was written, and
          // the form shows the lane as it is now.
          alert(laneMovedOnMessage());
          updatePlayersScore();
          return;
        }
        if (responsedata && responsedata.success === "false" && responsedata.reason === "scoreChanged") {
          // The same bowler, with balls this form does not hold: it would have taken them away.
          alert(scoreChangedMessage());
          fillPlayerScore();
          return;
        }
        $("#changescoreform")[0].reset();
        removeAnchorFromUrl();
      }
  });
}

function scoreChangedMessage() {
  switch ((typeof lang === "string" ? lang : "english").toLowerCase()) {
    case "svenska":  return "Resultatet har ändrats medan formuläret var öppet, så ändringen sparades inte.\nKontrollera resultatet och gör om ändringen om det behövs.";
    case "suomeksi": return "Tulos on muuttunut lomakkeen ollessa auki, joten muutosta ei tallennettu.\nTarkista tulos ja tee muutos uudelleen tarvittaessa.";
    case "deutsch":  return "Das Ergebnis hat sich geändert, während das Formular geöffnet war, deshalb wurde die Änderung nicht gespeichert.\nBitte das Ergebnis prüfen und die Änderung bei Bedarf wiederholen.";
    case "dansk":    return "Resultatet er ændret, mens formularen var åben, så ændringen blev ikke gemt.\nKontrollér resultatet, og gentag ændringen, hvis det er nødvendigt.";
    case "norsk":    return "Resultatet er endret mens skjemaet var åpent, så endringen ble ikke lagret.\nKontroller resultatet og gjør endringen på nytt om nødvendig.";
    default:         return "The score changed while this form was open, so the change was not saved.\nCheck the score and make the change again if needed.";
  }
}

// In the lane's own language, like partnerBusyMessage. Used by the change players form too.
function laneMovedOnMessage() {
  switch ((typeof lang === "string" ? lang : "english").toLowerCase()) {
    case "svenska":  return "Banan har gått vidare till en ny serie eller andra spelare, så ändringen sparades inte.\nKontrollera uppgifterna och gör om ändringen om det behövs.";
    case "suomeksi": return "Rata on siirtynyt uuteen sarjaan tai muille pelaajille, joten muutosta ei tallennettu.\nTarkista tiedot ja tee muutos uudelleen tarvittaessa.";
    case "deutsch":  return "Die Bahn ist zu einer neuen Serie oder zu anderen Spielern gewechselt, deshalb wurde die Änderung nicht gespeichert.\nBitte prüfen und die Änderung bei Bedarf wiederholen.";
    case "dansk":    return "Banen er gået videre til en ny serie eller andre spillere, så ændringen blev ikke gemt.\nKontrollér oplysningerne, og gentag ændringen, hvis det er nødvendigt.";
    case "norsk":    return "Banen har gått videre til en ny serie eller andre spillere, så endringen ble ikke lagret.\nKontroller opplysningene og gjør endringen på nytt om nødvendig.";
    default:         return "The lane has moved on to a new game or other players, so the change was not saved.\nCheck the details and make the change again if needed.";
  }
}

function hideChangeScoreForm() {
  $("#changescore").hide();
}

function showChangeScoreForm() {
  $("#changescore").show();
}
function updateCorrectButtons() {
  if (focusedCell < 0) return;
  var x = document.getElementById("correctButtons").querySelectorAll("button"); 
  var otherThrow = 0;
  var is1stThrow = isFirstThrow(focusedCell);

  for (var i=0; i<x.length; i++) x[i].disabled = false;

  if (is1stThrow)
  { // if it is first throw
    x[11].disabled = true;
    x[10].disabled = false;
    otherThrow = scoreRows.cells[focusedCell + 1].innerHTML;
  }
  else
  { // if it is second throw
    x[10].disabled = true;
    x[11].disabled = false;
    otherThrow = scoreRows.cells[focusedCell - 1].innerHTML;
  }

  if (otherThrow === "X" && focusedCell < 18)
  {
    for (var i=0; i<13; i++) x[i].disabled = true;
    return;
  }
  else if (otherThrow === "/")
    return;
  else if (otherThrow === "-")
    otherThrow = 0;
  else if (otherThrow === "")
    otherThrow = 0;

  for (var i=0; i<10; i++) 
  {
    if (i>((is1stThrow ? 10 : 9)-otherThrow))
      x[i].disabled = true;
    else
      x[i].disabled = false;
  }

  for (var i=0; i<12; i++) 
  {  
    if (scoreRows.cells[focusedCell].innerHTML === x[i].innerHTML)
    {
      x[i].disabled = true;
      return;
    }
  }  
}
function setFocusedCell() {
  loseFocus();
  focusedCell = document.activeElement.index;
  getFocus();

  updateCorrectButtons();
}

$(function() {
$("#changeScoreButton").click(updatePlayersScore);
$("#changescoresubmitbutton").click(submitChangeScoreForm);
$("#addScoreButton").click(addPlayerScore);
$("#deleteScoreButton").click(deletePlayerScore);
$("#resetScoreButton").click(resetPlayerScore);
$("#cancelButton").click(hideChangeScoreForm);
});