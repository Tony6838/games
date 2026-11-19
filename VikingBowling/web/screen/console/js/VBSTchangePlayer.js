var currentPlayerList = document.getElementById("selectplayerlistCurrentPlayers");
var reservPlayerList = document.getElementById("selectplayerlistReservPlayers");
var changePlayersubmiBbn = document.getElementById("changePlayersubmitbutton");
var changePlayerText = document.getElementById("changePlayerInfo");

function updateVBSTplayers() {
  $("#changePlayer").show();
  $("#selectplayerlistCurrentPlayers").empty();
   
  $.getJSON('/console/VBSTcurrentPlayers.json?lane=' + getLane(), function( data ) {
    for (var i=0; i < data.players.length; i++)
    {
      var player = data.players[i];
      var option = document.createElement("option");
      option.setAttribute("class", "btn btn-primary btn-lg btn-block lookUpName");
      option.setAttribute("value", player.teamName + "~~~" + player.internalID + "~~~" + player.notBegin);
      option.innerHTML = player.name;
      currentPlayerList.add(option);
    }
    updateVBSTreservPlayers();
  });
} 

function updateVBSTreservPlayers() {
  $("#selectplayerlistReservPlayers").empty();

  var currentPlayer = currentPlayerList.getElementsByTagName("option");
  var values = currentPlayer[currentPlayerList.selectedIndex].value.split("~~~");;

  if (values[2] == true) // value 2 is bool player has not begun play
  {
    changePlayersubmiBbn.disabled = false;
    changePlayerText.innerHTML = "Vid Svensk banpoängsmatch:<br>Taktiska byten skall ske i början av serien. Vid skadad spelare skall reservspelaren fortsätta på dennes protokoll.<br>Byten kan utföras när som helst från receptionen om andra regler gäller. ";
  }
  else
  {
    changePlayersubmiBbn.disabled = true;
    changePlayerText.innerHTML = "OBS! Spelaren har redan spelat och får inte bytas ut.<br>Från banterminalen kan bara taktiska byten göras i början av serien. Byten kan utföras när som helst från receptionen.";
  }

  $.getJSON('/console/VBSTreservPlayers.json?lane=' + getLane() + '&teamName=' + values[0], function( data ) {
    for (var i=0; i < data.players.length; i++)
    {
      var player = data.players[i];
      var option = document.createElement("option");
      option.setAttribute("class", "btn btn-primary btn-lg btn-block lookUpName");
      option.setAttribute("value", player.teamName + "~~~" + player.internalID);
      option.innerHTML = player.name;
      reservPlayerList.add(option);
    }
  });
} 

function submitchangePlayersubmit() {
  var currentPlayer = currentPlayerList.getElementsByTagName("option");
  var valuesCurrent = currentPlayer[currentPlayerList.selectedIndex].value.split("~~~");
  var reservtPlayer = reservPlayerList.getElementsByTagName("option");
  var valuesReserv  = reservtPlayer[reservPlayerList.selectedIndex].value.split("~~~");

  $.ajax({
      url: '/console/changePlayer?lane=' + getLane() + "&currentPlayerID=" + valuesCurrent[1] + "&reservPlayerID=" + valuesReserv[1] + "&teamName=" + valuesCurrent[0],
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        $("#changePlayer").hide();
      }
  });
}

$(function() {
$("#VBSTchangePlayerButton").click(updateVBSTplayers);
$("#changePlayersubmitbutton").click(submitchangePlayersubmit);
});
