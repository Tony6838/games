var saveButton = document.getElementById("saveMovePlaysubmitbutton");

function updateLanes(place) {
  $.getJSON('/console/lanes.json?lane=' + getLane(), function(data)
  {
    // Nothing calls updateLanes("main") today - the lane switcher a hall actually
    // uses is TouchConsole2.html, which builds the same links from its own two
    // buttons. Kept rather than deleted because it is the general form of that
    // page (every lane the slave serves, not just the pair), but the two defects
    // below were both fixed in place so it is correct if it is ever wired up.
    if (place === "main")
    {
      $('#main_content').html('');
      $('#main_content').append('<h1>Välj bana</h1>');
      for (var i=0; i < data.lanes.length; i++) {
        // The lane number, not the position in the list. A slave serving lanes
        // 17-24 answers [17,18,...], so comparing i+1 skipped whichever lane
        // happened to sit at that index and left the current one in the list.
        if (data.lanes[i] == getLane()) continue;
        // Name the page. "./?lane=" is the directory, and neither console folder
        // has an index document, so every one of these links answered 404.
        $('#main_content').append('<a style="margin: 5px;" class="btn btn-primary btn-lg col-xl-1" href="TouchConsole.html?lane=' + data.lanes[i] + '">'+ data.lanes[i] + '</a>');
      }
    }
    else if (place === "moveGame")
    {
      $('#targetLanes').html('');
      
      if (lang.toLowerCase() === "svenska")
        $('#targetLanes').append('<h3>Avsluta och flytta spel till bana <span id="theTarget" style="color: red; font-size: 3rem;"></span></h3>');
      else if (lang.toLowerCase() === "suomeksi")
        $('#targetLanes').append('<h3>Lopeta ja siirrä peli radalle <span id="theTarget" style="color: red; font-size: 3rem;"></span></h3>');
      else
        $('#targetLanes').append('<h3>Finish and move game to lane <span id="theTarget" style="color: red; font-size: 3rem;"></span></h3>');

      for (var i=0; i < data.lanes.length; i++) {
        $('#targetLanes').append('<button style="margin: 2px;" class="btn btn-primary btn-lg col-x1-auto generalButton" onclick="selectMoveLane(this)">'+ data.lanes[i] + '</button>');
      }
    }
  });
}

function submitsaveMovePlaysubmit() {
  $.ajax({
      url: '/console/saveMovePlay?lane=' + getLane() + '&targetLane=' + document.getElementById("theTarget").innerHTML,
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        $("#saveMovePlay").hide();
      }
  });
  location.hash = "#fillBowlingData";
}

function selectMoveLane(x) {
  document.getElementById("theTarget").innerHTML = x.innerHTML;
  saveButton.disabled  = false;
}

function resetSaveMoveGameForm() {
  updateLanes("moveGame");
  $("#saveMovePlay").show();
  saveButton.disabled  = true;
}

function submitstartMovePlaysubmit() {
  $.ajax({
      url: '/console/startMovePlay?lane=' + getLane(),
      type: 'get',
      dataType: 'json',
      success: function(responsedata) {
        $("#startMovePlay").hide();
        window.location.replace(window.location.pathname + window.location.search);
        oldLaneImgIndex = 0;
      }
  });
}

function checkIfMoveFileExists() {
  $.getJSON('/console/checkMoveFile.json?lane=' + getLane(), function(data)
  {
    if (data.moveFileExists === "true")
      $("#startMovePlayDivision").show();
    else
      $("#startMovePlayDivision").hide();
  });  
}

$(function() {
  $("#saveMovePlayButton").click(resetSaveMoveGameForm);
  $("#saveMovePlaysubmitbutton").click(submitsaveMovePlaysubmit);
  $("#startMovePlaysubmitbutton").click(submitstartMovePlaysubmit);
});
