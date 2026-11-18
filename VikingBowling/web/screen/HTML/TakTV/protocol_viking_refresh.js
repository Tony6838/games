// ---------------------------------------------------------------------------
// protocol_viking_refresh.js - the "Viking Refresh" scoring layout as data for
// the HTML renderer, transcribed from:
//
//   C:\Viking2001\V3GFX\Protocols\Viking Refresh\protocol.xml
//                                               \Header.xml
//                                               \Time.xml
//                                               \GridsStandard.xml
//                                               \CommonInfo.xml
//                                               \CommonInfoAddon.xml
//                                               \RedPinGrids.xml
//                                               \RedPinGridsFrame.xml
//                                               \TeamInfo.xml   (layer_after_9 only)
//
// This is the theme the lanes on the test rig are actually configured for
// (registry v3GfxProtocol, per lane), which is why it exists alongside
// protocol_viking.js: it makes the HTML output directly comparable to the
// VTVFile<lane>.jpg the rig writes.
//
// It generates at 1920x1080 rather than Viking's 640x480, and it is structurally
// simpler: the player row has no layer_before_1, so there is no separate
// "under" bitmap - Active.png / Inactive.png already carry the name band and the
// cell grid, and every text sits in layer_after_*.
//
// Same omissions as protocol_viking.js, for the same reasons: the
// #PINS_ON_PROTOCOL# import, MessageInfo.xml, and the TeamInfo bottom panel
// (team sums need the partner lane).
//
// One thing transcribed but permanently invisible, on purpose:
// RedPinGridsFrame.xml asks for #FRAME_RED_PIN_FRAME_n#. That id reaches the
// "_PIN_" branch of CGame::GetText, which only ever answers to
// #FRAME_RED_PIN_MISS_ and #FRAME_RED_PIN_STRIKE_ - so it resolves empty and the
// picture is never drawn. Kept so the file corresponds 1:1 with the XML.
// ---------------------------------------------------------------------------

/* exported VBS_PROTOCOL_VIKING_REFRESH */

(function () {
  'use strict';

  // The two folders this layout draws from, exactly the two the XML names, given
  // relative to this page: C:\Viking2001\web\screen\HTML\TakTV\ is four levels
  // below C:\Viking2001. Both the WebView2 virtual host and the web server that
  // will serve this page are rooted there, so one relative path serves both -
  // and file:// too, which is the fallback when the runtime cannot map a virtual
  // host. Relative rather than "/v3gfx/..." for exactly that reason: a
  // root-absolute URL under file:// would resolve to the root of the drive.
  // The folder really is called "Viking Refresh", hence the %20.
  var PROTOCOL_DIR = '../../../../v3gfx/Protocols/Viking%20Refresh/';
  var OBJECTS_DIR = '../../../../v3gfx/Resource/Objects/';

  var IMAGE_SIZE = {
    'Active.png': [1920, 284],
    'Inactive.png': [1920, 284],
    'Regular.png': [1849, 174],
    'Substitute.png': [1849, 174],
    'Pacer.png': [1849, 174],
    'Vacancy.png': [1849, 174],
    'Absent.png': [1849, 174],
    'Left.png': [204, 204],
    'Right.png': [204, 204],
    'RedPin172x86Enabled.png': [172, 86],
    'RedPin172x86Strike.png': [172, 86],
    'RedPin86x86Enabled.png': [86, 86],
    'RedPin86x86Strike.png': [86, 86]
  };

  // Keyed by the full path, because that is what the element carries as its
  // <file> - see vbsImageUrl. Assigned rather than written into the literal
  // above only because the key is not a constant expression.
  IMAGE_SIZE[OBJECTS_DIR + 'B600x110R10.png'] = [600, 110];
  IMAGE_SIZE[OBJECTS_DIR + 'RedPin.png'] = [200, 50];
  IMAGE_SIZE['TeamSums.png'] = [1920, 196];

  var WHITE = { trans: '255', red: '255', green: '255', blue: '255' };
  var BLACK = { trans: '255', red: '0', green: '0', blue: '0' };
  var SHADOW = { trans: '155', red: '0', green: '0', blue: '0' };

  // --- Header.xml ---------------------------------------------------------
  function header() {
    var out = [{
      k: 'text',
      text: '1',
      font: 'Arial',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: { x: '35', y: '310;210;100', w: '174', h: '35' },
      fontstyle: 'bold',
      align: 'center',
      aspect: '0.75',
      halo: '0',
      penWidth: '1',
      shadow: '2',
      isTextRec: '0'
    }];
    for (var n = 2; n <= 10; n++) {
      var e = { k: 'text', text: String(n), rect: { x: '+=176' } };
      if (n === 10) e.rect.w = '258';
      out.push(e);
    }
    return out;
  }

  // --- Time.xml -----------------------------------------------------------
  function playTime() {
    return [{
      k: 'picture',
      id: '#IS_OPENPLAY#',
      file: null,                       // Objects\Empty200x100.png, a transparent spacer
      nativeW: 200,
      nativeH: 100,
      rect: { x: '1700', y: '1030;1030;1030;1030;1035;1030', w: '200', h: '50' },
      layer_after_1: [
        {
          k: 'text',
          id: '#PLAY_TIME#',
          text: '',
          fill: WHITE,
          shadowColor: SHADOW,
          font: 'Arial',
          fontstyle: 'normal',
          rect: { x: '0', y: '20', w: '110', h: '80' },
          align: 'right',
          aspect: '0.65',
          isTextRec: '1'
        },
        {
          k: 'text',
          text: 'min',
          rect: { x: '125', y: '20', w: '75', h: '80' },
          align: 'left',
          aspect: '0.75',
          isTextRec: '1'
        }
      ]
    }];
  }

  // --- GridsStandard.xml --------------------------------------------------
  function gridsStandard() {
    var out = [{
      k: 'text',
      id: '#THROW1#',
      font: 'bowler',
      fill: BLACK,
      rect: { x: '46', y: '16', w: '66', h: '66' },
      fontstyle: 'bold',
      align: 'center',
      isTextRec: '0',
      aspect: '0.85',
      halo: '0'
    }];
    for (var t = 2; t <= 21; t++)
      out.push({ k: 'text', id: '#THROW' + t + '#', rect: { x: '+=88' } });

    out.push({
      k: 'text', id: '#SUM_HCP_1#',
      rect: { x: '46', y: '104', w: '154', h: '66' }
    });
    for (var s = 2; s <= 10; s++) {
      var e = { k: 'text', id: '#SUM_HCP_' + s + '#', rect: { x: '+=176' } };
      if (s === 10) e.rect.w = '252';
      out.push(e);
    }

    out.push({
      k: 'picture',
      file: '#PLAYER_STATUS#',
      rect: { x: '36', y: '6', w: '1849', h: '174' },
      colorFactor: '1',
      trans: '1'
    });

    return out;
  }

  // --- RedPinGrids.xml / RedPinGridsFrame.xml -----------------------------
  var RED_PIN_X = ['36', '212', '388', '564', '740', '916', '1092', '1268', '1444', '1620'];

  function redPinGrids() {
    var out = [];
    for (var f = 1; f <= 10; f++) {
      var wide = f < 10;
      var w = wide ? '172' : '86';
      var miss = {
        k: 'picture', id: '#FRAME_RED_PIN_MISS_' + f + '#',
        file: wide ? 'RedPin172x86Enabled.png' : 'RedPin86x86Enabled.png',
        rect: { x: RED_PIN_X[f - 1], y: '6', w: w, h: '86' }
      };
      var strike = {
        k: 'picture', id: '#FRAME_RED_PIN_STRIKE_' + f + '#',
        file: wide ? 'RedPin172x86Strike.png' : 'RedPin86x86Strike.png',
        rect: { x: RED_PIN_X[f - 1], y: '6', w: w, h: '86' }
      };
      if (f === 1) { miss.trans = '1'; strike.trans = '1'; }
      out.push(miss, strike);
    }
    return out;
  }

  // Never resolves - see the note at the top of this file.
  function redPinGridsFrame() {
    var out = [];
    for (var f = 1; f <= 10; f++) {
      var wide = f < 10;
      var e = {
        k: 'picture', id: '#FRAME_RED_PIN_FRAME_' + f + '#',
        file: wide ? 'RedPin172x86Enabled.png' : 'RedPin86x86Enabled.png',
        rect: { x: RED_PIN_X[f - 1], y: '6', w: wide ? '172' : '86', h: '86' }
      };
      if (f === 1) e.trans = '1';
      out.push(e);
    }
    return out;
  }

  function nextGameLane() {
    return {
      k: 'picture',
      id: '||||||||#ID_NEXT_GAME_LANE#',
      file: OBJECTS_DIR + 'B600x110R10.png',
      rect: { x: '265', y: '26', w: '600', h: '150' },
      colorFactor: '1',
      trans: '1',
      layer_before_1: [{
        k: 'rect',
        rect: { x: '5', y: '5', w: '590', h: '90' },
        color: { trans: '205', red: '0', green: '0', blue: '0' }
      }],
      layer_after_1: [
        {
          k: 'text',
          id: '#NEXT_GAME_LANED#',
          font: 'Arial',
          fill: WHITE,
          rect: { x: '40', y: '15', w: '350', h: '70' },
          penWidth: '2',
          aspect: '0.85',
          align: 'center',
          isTextRec: '1'
        },
        {
          k: 'text',
          id: '#NEXT_GAME_LANE#',
          font: 'Arial',
          rect: { x: '410', y: '20', w: '150', h: '60' },
          align: 'center',
          aspect: '0.85',
          isTextRec: '0'
        }
      ]
    };
  }

  // The name / speed / HCP / SER / TOT line. Identical between the active and
  // the inactive row except for #TOT#'s is_text_rec, which the inactive row
  // turns off for 6 players and up.
  function nameBand(totIsTextRec) {
    return [
      {
        k: 'text',
        id: '#NAME#',
        text: 'Player1',
        font: 'Arial',
        fill: BLACK,
        rect: { x: '46', y: '196', w: '500', h: '66' },
        fontstyle: 'bold',
        align: 'left',
        aspect: '0.75',
        halo: '0',
        shadow: '0',
        penWidth: '0',
        isTextRec: '1'
      },
      {
        k: 'text', id: '#SPEED#',
        rect: { x: '610', y: '196', w: '180', h: '66' },
        align: 'left', aspect: '0.75', isTextRec: '1'
      },
      {
        k: 'text', id: '#HCPD#', text: 'HCP',
        rect: { x: '930', y: '196', w: '100', h: '66' },
        aspect: '0.75', isTextRec: '1'
      },
      {
        k: 'text', id: '#HCP#', text: '44',
        rect: { x: '1050', y: '196', w: '100', h: '66' },
        aspect: '0.75', isTextRec: '1'
      },
      {
        k: 'text', id: '#SCRD#', text: 'SER',
        rect: { x: '1250', y: '196', w: '110', h: '66' },
        aspect: '0.75', align: 'left', isTextRec: '1'
      },
      {
        k: 'text', id: '#SCR#', text: '44',
        rect: { x: '1390', y: '196', w: '160', h: '66' },
        aspect: '0.75', align: 'left', isTextRec: '1'
      },
      {
        k: 'text', id: '#TOTD#', text: 'TOT',
        rect: { x: '1570', y: '196', w: '100', h: '66' },
        align: 'left', aspect: '0.75', isTextRec: '1'
      },
      {
        k: 'text', id: '#TOT#', text: '44',
        rect: { x: '1700', y: '196', w: '160', h: '66' },
        aspect: '0.75', isTextRec: totIsTextRec
      }
    ];
  }

  var activePlayer = {
    file: 'Active.png',
    y_pre_addon: '10;10;10;2;2;2;1',
    y_post_addon: '10;10;10;2;2;2;1',
    xpos: '0',
    y_scale: '1.05;1.05;1;0.78;0.61;0.61;0.61;0.53',

    layer_after_1: nameBand('1'),
    layer_after_2: gridsStandard(),
    layer_after_3: redPinGridsFrame().concat(redPinGrids()).concat([
      {
        k: 'picture', id: '#LEFT_ARROW#', file: 'Left.png',
        rect: { x: '36', y: '6', w: '174', h: '174' }, colorFactor: '1.0', trans: '0.80'
      },
      {
        k: 'picture', id: '#RIGHT_ARROW#', file: 'Right.png',
        rect: { x: '1706', y: '6', w: '174', h: '174' }, colorFactor: '1.0', trans: '0.80'
      },
      nextGameLane()
    ])
  };

  var inactivePlayer = {
    file: 'Inactive.png',
    y_pre_addon: '10;10;10;1;1;1;1',
    y_post_addon: '10;10;10;0;0;0;0',
    xpos: '0',
    y_scale: '1.05;1.05;1;0.78;0.64;0.51;0.41;0.37',

    layer_after_1: nameBand('1;1;1;1;1;0'),
    layer_after_2: gridsStandard(),
    layer_after_3: redPinGrids().concat([nextGameLane()])
  };

  // --- CommonInfo.xml -----------------------------------------------------
  var commonInfo = [
    {
      k: 'text',
      id: '#LANE_NUMBER#',
      text: '',
      font: 'Arial',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: { x: '40', y: '20', w: '80', h: '80' },
      fontstyle: 'bold',
      align: 'center',
      aspect: '0.85',
      halo: '0',
      shadow: '3',
      penWidth: '1',
      isTextRec: '0'
    },
    {
      k: 'text',
      id: '#GAMED#',
      text: '',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: { x: '1640', y: '185;75;55', w: '100', h: '75;55;45' },
      fontstyle: 'bold',
      align: 'right',
      aspect: '0.75',
      halo: '0',
      shadow: '2',
      penWidth: '0',
      isTextRec: '1'
    },
    {
      k: 'text',
      id: '#GAME#',
      text: '',
      rect: { x: '1750', y: '185;75;55', w: '100', h: '75;55;45' },
      fontstyle: 'bold',
      align: 'left',
      aspect: '0.75',
      isTextRec: '1',
      shadow: '2'
    },
    {
      k: 'text',
      id: '#GAMEMODE#',
      text: '',
      rect: { x: '1640', y: '135;25;15', w: '150', h: '45;45;35' },
      align: 'center',
      aspect: '0.75',
      isTextRec: '1'
    }
  ];

  // --- CommonInfoAddon.xml ------------------------------------------------
  var commonInfoAddon = [{
    k: 'picture',
    id: '#IS_REDPIN#',
    file: OBJECTS_DIR + 'RedPin.png',
    rect: { x: '1610', y: '135;25;15', w: '200', h: '45;45;35' }
  }];

  // --- TeamInfo.xml, layer_after_9 only -----------------------------------
  var teamName = [{
    k: 'text',
    id: '#LANE_TEAMNAME#',
    text: 'Lagnamn',
    font: 'Arial',
    fill: WHITE,
    shadowColor: SHADOW,
    rect: { x: '220', y: '25;25;20', w: '1050', h: '70;70;60' },
    fontstyle: 'bold',
    align: 'left',
    aspect: '0.75',
    halo: '0',
    shadow: '2',
    penWidth: '0',
    isTextRec: '1'
  }];

  // --- TeamInfo.xml, <bottom_panel_1> ------------------------------------
  // The team-sums strip: the running total of every player on the lane, frame by
  // frame, with the team name and total under it. Transcribed from this theme's
  // own TeamInfo.xml, which is already authored at 1920x1080 - so unlike the
  // Viking one it needs no re-proportioning.
  //
  // Gated by #TFSUM#, which resolves empty unless the lane sum is in use. That
  // is what makes it appear for a Lagspel game (GAMETYPE == LC_START_TEAMPLAY)
  // and stay away from an ordinary competition - see calcStatusLine.
  //
  // The "+=176" steps and the inherited text attributes work exactly as they do
  // in the XML: only #FSUM_HCP_1# carries colour, font and size, and 2..10 take
  // them from it.
  var teamSumsPanel = {
    id: '#TFSUM#',
    y_generate: '135',
    elements: [{
      k: 'picture',
      id: '#TFSUM#',
      file: 'TeamSums.png',
      rect: { x: '200', y: '0', w: '1520', h: '135' },

      layer_before_1: [{
        k: 'rect',
        rect: { x: '36', y: '6', w: '1848', h: '174' },
        color: { trans: '215', red: '255', green: '255', blue: '255' }
      }],

      layer_after_1: [
        {
          k: 'text',
          id: '#LANE_TEAMNAME#',
          text: 'Lagnamn',
          font: 'Arial',
          fill: BLACK,
          rect: { x: '46', y: '104', w: '900', h: '66' },
          fontstyle: 'bold',
          align: 'left',
          aspect: '0.75',
          halo: '0',
          shadow: '0',
          penWidth: '0',
          isTextRec: '1'
        },
        { k: 'text', text: 'TOT', rect: { x: '1500', w: '100' }, isTextRec: '0' },
        { k: 'text', id: '#TFSUM#', rect: { x: '1630', w: '234' } },
        {
          k: 'text',
          id: '#FSUM_HCP_1#',
          rect: { x: '46', y: '16', w: '154', h: '66' },
          fill: BLACK,
          shadowColor: SHADOW,
          fontstyle: 'bold',
          align: 'center',
          aspect: '0.75',
          halo: '0',
          shadow: '1',
          isTextRec: '0'
        },
        { k: 'text', id: '#FSUM_HCP_2#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_3#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_4#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_5#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_6#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_7#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_8#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_9#', rect: { x: '+=176' } },
        { k: 'text', id: '#FSUM_HCP_10#', rect: { x: '+=176', w: '242' } }
      ]
    }]
  };

  window.VBS_PROTOCOL_VIKING_REFRESH = {
    name: 'Viking Refresh',
    imagePath: PROTOCOL_DIR,
    imageSize: IMAGE_SIZE,
    x_generate: 1920,
    y_generate: 1080,
    y_start: '350;250;140',

    layer_before_1: header().concat(playTime()),

    active_player: activePlayer,
    inactive_player: inactivePlayer,

    // Header.xml is imported a second time here, so the frame numbers are drawn
    // again on top of the player rows. That is what the XML says.
    layer_after_1: commonInfo.concat(header()),
    layer_after_2: commonInfoAddon,
    layer_after_9: teamName,

    bottom_panel_1: teamSumsPanel
  };
}());
