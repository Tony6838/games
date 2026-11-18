// ---------------------------------------------------------------------------
// protocol_viking.js - the "Viking" scoring layout, as data for the HTML
// renderer. This replaces the XML protocol that GDI_plus_helper::BitmapFromXml
// reads, i.e. all of:
//
//   C:\Viking2001\V3GFX\Protocols\Viking\protocol.xml
//                                       \Viking2001_Header.xml
//                                       \Time.xml
//                                       \Viking2001_StandardGrids.xml
//                                       \Viking2001_CommonInfo.xml
//                                       \Viking2001_CommonInfoAddon.xml
//                                       \Viking2001_RedPin.xml
//                                       \Viking2001_TeamInfo.xml   (partly, see below)
//
// The numbers below are transcribed verbatim from those files, semicolon lists
// and all, so a reviewer can diff this against the XML line by line. The
// semicolon/pipe/"+=" semantics are unchanged and are implemented by
// vbsrender.js exactly as CMyXml::GetElementContens does:
//
//   "a;b;c"   pick by (number of players - 1), clamped to the last entry
//   "a|b|c"   pick by the active frame,        clamped to the last entry
//   "+=n"     add n to whatever the previous element left in that field
//
// Not carried over, deliberately, and why:
//   layer_after_3 <import>#PINS_ON_PROTOCOL#</import>  - a second protocol tree
//       under V3GFX\Resource\Pins_On_Protocol; a separate layout of its own.
//   layer_after_4 <import>Viking2001_MessageInfo.xml</import> - the message /
//       animation overlay, driven by live LoadCom events rather than by the
//       lane file this page renders.
//   <bottom_panel_1> from Viking2001_TeamInfo.xml - team sums need the partner
//       lane's data (CalcStatusLine), which a single lane file does not carry.
//   The left/right cross-lane arrows are described here but never resolve,
//       for the same reason.
// ---------------------------------------------------------------------------

/* exported VBS_PROTOCOL_VIKING */

(function () {
  'use strict';

  // The two folders this layout draws from, exactly the two the XML names, given
  // relative to this page: C:\Viking2001\web\screen\HTML\TakTV\ is four levels
  // below C:\Viking2001. Both the WebView2 virtual host and the web server that
  // will serve this page are rooted there, so one relative path serves both -
  // and file:// too, which is the fallback when the runtime cannot map a virtual
  // host. Relative rather than "/v3gfx/..." for exactly that reason: a
  // root-absolute URL under file:// would resolve to the root of the drive.
  var PROTOCOL_DIR = '../../../../v3gfx/Protocols/Viking/';
  var OBJECTS_DIR = '../../../../v3gfx/Resource/Objects/';

  // Natural pixel size of every image the layout draws. BitmapFromXml gets this
  // from the PNG itself and uses it as the coordinate space of the element's
  // sub-layers; here it has to be declared so nothing depends on decode timing.
  var IMAGE_SIZE = {
    'Viking2001_Grid1-5_Active.png': [620, 98],
    'Viking2001_Grid1-5_Inactive.png': [610, 88],
    'Viking2001_Grid6-8_Active.png': [620, 69],
    'Viking2001_Grid6-8_Inactive.png': [610, 59],
    'Regular.png': [620, 69],
    'Substitute.png': [620, 69],
    'Pacer.png': [620, 69],
    'Vacancy.png': [620, 69],
    'Absent.png': [620, 69],
    'LeftArrow.png': [62, 66],
    'RightArrow.png': [62, 66],
    'RedPin1-9.png': [57, 36],
    'RedPin10.png': [28, 36],
    'Viking2001_Team_Sums1-5.png': [610, 60],
    'Viking2001_Team_Sums6-8.png': [610, 60]
  };

  // Keyed by the full path, because that is what the element carries as its
  // <file> - see vbsImageUrl. Assigned rather than written into the literal
  // above only because the key is not a constant expression.
  IMAGE_SIZE[OBJECTS_DIR + 'RedPin.png'] = [200, 50];
  IMAGE_SIZE[OBJECTS_DIR + 'MessageFrame.png'] = [440, 280];

  var WHITE = { trans: '255', red: '255', green: '255', blue: '255' };
  var BLACK = { trans: '255', red: '0', green: '0', blue: '0' };
  var SHADOW = { trans: '155', red: '0', green: '0', blue: '0' };

  // --- Viking2001_Header.xml ---------------------------------------------
  // Frame numbers 1..10 across the top of the sheet.
  function header() {
    var out = [{
      k: 'text',
      text: '1',
      font: 'Arial',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: {
        x: '15;15;15;15;15;122',
        y: '132;92;62;47;47;47;47;42',
        w: '58;58;58;58;58;47',
        h: '15'
      },
      fontstyle: 'bold',
      align: 'center',
      aspect: '0.75',
      halo: '0',
      penWidth: '1',
      shadow: '2',
      isTextRec: '0'
    }];

    for (var n = 2; n <= 10; n++) {
      var e = { k: 'text', text: String(n), rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } };
      if (n === 10) e.rect.w = '86;86;86;86;86;70';
      out.push(e);
    }
    return out;
  }

  // --- Time.xml -----------------------------------------------------------
  // Remaining/elapsed play time, open play only. The frame is
  // Objects\Empty200x100.png - a fully transparent spacer whose only job is to
  // give the two texts a 200x100 coordinate space, so no file is loaded here.
  function playTime() {
    return [{
      k: 'picture',
      id: '#IS_OPENPLAY#',
      file: null,
      nativeW: 200,
      nativeH: 100,
      rect: { x: '530', y: '455;455;455;455;460', w: '100', h: '25;25;25;25;20' },
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

  // --- Viking2001_StandardGrids.xml --------------------------------------
  // The 21 throw squares and the 10 running totals, plus the bowler-type badge.
  function standardGrids() {
    var out = [{
      k: 'text',
      id: '#THROW1#',
      font: 'bowler',
      fill: BLACK,
      rect: { x: '2;2;2;2;2;107', y: '3', w: '26;26;26;26;26;21', h: '22' },
      fontstyle: 'bold',
      align: 'center',
      aspect: '0.85',
      halo: '0'
    }];

    for (var t = 2; t <= 21; t++) {
      out.push({
        k: 'text',
        id: '#THROW' + t + '#',
        rect: { x: '+=29;+=29;+=29;+=29;+=29;+=24', w: '26;26;26;26;26;21' }
      });
    }

    out.push({
      k: 'text',
      id: '#SUM_HCP_1#',
      rect: { x: '1;1;1;1;1;107', y: '31', w: '57;57;57;57;57;47', h: '24' }
    });
    for (var s = 2; s <= 10; s++) {
      out.push({
        k: 'text',
        id: '#SUM_HCP_' + s + '#',
        rect: {
          x: '+=58;+=58;+=58;+=58;+=58;+=48',
          w: (s === 10) ? '86;86;86;86;86;70' : '57;57;57;57;57;47'
        }
      });
    }

    // Regular / Substitute / Pacer / Vacancy / Absent, resolved through the file
    // token rather than an id - so it is always drawn, and always underneath the
    // throws (pictures paint before texts inside a layer).
    out.push({
      k: 'picture',
      file: '#PLAYER_STATUS#',
      rect: { x: '1', y: '1', w: '608', h: '86;86;86;86;86;56' },
      colorFactor: '1',
      trans: '1'
    });

    return out;
  }

  // --- Viking2001_RedPin.xml ---------------------------------------------
  // A red-pin marker over the frame it was scored in. Frames 1-9 use the wide
  // image, frame 10 the narrow one. Both the MISS and the STRIKE id are kept
  // because they gate on different score values even though this theme draws
  // the same picture for either.
  function redPin() {
    var xMiss = ['1;1;1;1;1;107', '59;59;59;59;59;155', '117;117;117;117;203',
      '175;175;175;175;175;251', '233;233;233;233;233;299', '291;291;291;291;291;347',
      '349;349;349;349;349;395', '407;407;407;407;407;443', '465;465;465;465;465;491',
      '523;523;523;523;523;539'];
    // Frame 9's STRIKE entry carries a bare "465" in the XML; kept as is.
    var xStrike = xMiss.slice();
    xStrike[8] = '465';

    var out = [];
    for (var f = 1; f <= 10; f++) {
      var file = (f < 10) ? 'RedPin1-9.png' : 'RedPin10.png';
      var w = (f < 10) ? '58;58;58;58;58;47' : '29';
      out.push({
        k: 'picture', id: '#FRAME_RED_PIN_MISS_' + f + '#', file: file,
        rect: { x: xMiss[f - 1], y: '1', w: w, h: '28' }, trans: '1'
      });
      out.push({
        k: 'picture', id: '#FRAME_RED_PIN_STRIKE_' + f + '#', file: file,
        rect: { x: xStrike[f - 1], y: '1', w: w, h: '28' }, trans: '1'
      });
    }
    return out;
  }

  // The "next lane" plate, shown from frame 9 onwards ("||||||||" selects by the
  // active frame, so index 0..7 are empty and 8 and up carry the id).
  function nextGameLane() {
    return {
      k: 'picture',
      id: '||||||||#ID_NEXT_GAME_LANE#',
      file: OBJECTS_DIR + 'MessageFrame.png',
      rect: { x: '65', y: '11', w: '200', h: '38' },
      colorFactor: '1',
      trans: '0.8',
      layer_after_1: [
        {
          k: 'text',
          id: '#NEXT_GAME_LANED#',
          font: 'Arial',
          fill: WHITE,
          rect: { x: '40', y: '50', w: '250', h: '200' },
          penWidth: '2',
          aspect: '0.75',
          align: 'center',
          isTextRec: '1'
        },
        {
          k: 'text',
          id: '#NEXT_GAME_LANE#',
          font: 'Arial',
          rect: { x: '310', y: '50', w: '80', h: '170' },
          align: 'center',
          aspect: '0.45',
          isTextRec: '0'
        }
      ]
    };
  }

  // The name / HCP / SER / TOT band under each player's grid. Identical for the
  // active and the inactive player apart from the two fills above it, so it is
  // built once and the caller supplies those.
  function nameBand() {
    return [
      {
        k: 'text',
        id: '#NAME#;#NAME#;#NAME#;#NAME#;#NAME#;#NAME8#',
        text: 'Player1',
        font: 'Arial',
        fill: BLACK,
        rect: { x: '4', y: '60;60;60;60;60;31', w: '175;175;175;175;175;105', h: '26' },
        fontstyle: 'bold',
        align: 'left',
        aspect: '0.75',
        halo: '0',
        shadow: '0',
        penWidth: '0',
        isTextRec: '1'
      },
      {
        k: 'text',
        id: '#SPEED#',
        rect: { x: '185', y: '64', w: '80;80;80;80;80;0', h: '22;22;22;22;22;0' },
        align: 'left',
        aspect: '0.75',
        isTextRec: '1'
      },
      {
        k: 'text',
        id: '#HCPD#',
        text: 'HCP',
        rect: { x: '290', y: '64', w: '50;50;50;50;50;0', h: '22;22;22;22;22;0' },
        aspect: '0.75',
        isTextRec: '1'
      },
      {
        k: 'text',
        id: '#HCP#',
        text: '44',
        rect: { x: '345', y: '64', w: '86;86;86;86;86;0', h: '18;18;18;18;18;0' },
        aspect: '0.75',
        isTextRec: '0'
      },
      {
        k: 'text',
        id: '#SCRD#',
        text: 'SER',
        rect: { x: '400', y: '64', w: '45;45;45;45;45;0', h: '22;22;22;22;22;0' },
        aspect: '0.75',
        isTextRec: '1'
      },
      {
        k: 'text',
        id: '#SCR#',
        text: '44',
        rect: {
          x: '420;420;420;420;420;4', y: '64;64;64;64;64;5',
          w: '86;86;86;86;86;0', h: '18;18;18;18;18;0'
        },
        aspect: '0.75',
        align: 'center',
        isTextRec: '0'
      },
      {
        k: 'text',
        id: '#TOTD#',
        text: 'TOT',
        rect: { x: '505', y: '64', w: '45;45;45;45;45;0', h: '22;22;22;22;22;0' },
        align: 'left',
        aspect: '0.75',
        isTextRec: '1'
      },
      {
        k: 'text',
        id: '#TOT#',
        text: '44',
        rect: {
          x: '555;555;555;555;555;4', y: '64;64;64;64;64;5',
          w: '70;70;70;70;70;97', h: '18;18;18;18;18;18'
        },
        aspect: '0.75',
        isTextRec: '0'
      }
    ];
  }

  var activePlayer = {
    file: 'Viking2001_Grid1-5_Active.png;Viking2001_Grid1-5_Active.png;' +
      'Viking2001_Grid1-5_Active.png;Viking2001_Grid1-5_Active.png;' +
      'Viking2001_Grid1-5_Active.png;Viking2001_Grid6-8_Active.png;' +
      'Viking2001_Grid6-8_Active.png;Viking2001_Grid6-8_Active.png',
    y_pre_addon: '5;5;5;2;2;2;2;2',
    y_post_addon: '4;4;4;1;1;1;1;1',
    xpos: '15',
    y_scale: '1.4;1.4;1.3;1.1;0.9;1.15;1.05;0.9',

    layer_before_1: [
      {
        k: 'gradient',
        mode: '1',
        p1: { x: '0', y: '0', color: { trans: '255;255;255;255;255;0', red: '255', green: '255', blue: '10' } },
        p2: { x: '304', y: '20', color: { trans: '255;255;255;255;255;0', red: '255', green: '75', blue: '0' } },
        rect: { x: '1', y: '59', w: '608', h: '28' }
      },
      { k: 'rect', rect: { x: '1', y: '1', w: '608', h: '28' }, color: WHITE },
      { k: 'rect', rect: { x: '1', y: '30', w: '608', h: '28' }, color: WHITE }
    ].concat(nameBand()),

    layer_after_1: standardGrids(),

    layer_after_2: redPin().concat([
      {
        k: 'picture', id: '#LEFT_ARROW#', file: 'LeftArrow.png',
        rect: { x: '0', y: '2', w: '62', h: '56' }, colorFactor: '1.0', trans: '0.80'
      },
      {
        k: 'picture', id: '#RIGHT_ARROW#', file: 'RightArrow.png',
        rect: { x: '548', y: '2', w: '62', h: '56' }, colorFactor: '1.0', trans: '0.80'
      },
      nextGameLane()
    ]),

    layer_after_3: []
  };

  var inactivePlayer = {
    file: 'Viking2001_Grid1-5_Inactive.png;Viking2001_Grid1-5_Inactive.png;' +
      'Viking2001_Grid1-5_Inactive.png;Viking2001_Grid1-5_Inactive.png;' +
      'Viking2001_Grid1-5_Inactive.png;Viking2001_Grid6-8_Inactive.png;' +
      'Viking2001_Grid6-8_Inactive.png;Viking2001_Grid6-8_Inactive.png',
    y_pre_addon: '5;5;5;1;1;1;1;1',
    y_post_addon: '4;4;4;2;2;2;2;2',
    xpos: '15',
    y_scale: '1.4;1.4;1.3;1.05;0.85;1;0.85;0.77',

    layer_before_1: [
      {
        k: 'gradient',
        mode: '1',
        p1: { x: '0', y: '0', color: { trans: '55;55;55;55;55;0', red: '255', green: '255', blue: '255' } },
        p2: { x: '317', y: '0', color: { trans: '55;55;55;55;55;0', red: '255', green: '255', blue: '255' } },
        rect: { x: '1', y: '59', w: '608', h: '28' }
      },
      { k: 'rect', rect: { x: '1', y: '1', w: '608', h: '28' }, color: { trans: '55', red: '255', green: '255', blue: '255' } },
      { k: 'rect', rect: { x: '1', y: '30', w: '608', h: '28' }, color: { trans: '55', red: '255', green: '255', blue: '255' } }
    ].concat(nameBand()),

    layer_after_1: standardGrids(),

    layer_after_2: redPin().concat([nextGameLane()]),

    layer_after_3: []
  };

  // --- Viking2001_CommonInfo.xml -----------------------------------------
  var commonInfo = [
    {
      k: 'text',
      id: '#LANE_NUMBER#',
      text: '',
      font: 'Arial',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: {
        x: '20;20;10', y: '20;20;10;10;10;10;10;6',
        w: '40;40;35;30;30;35;35;35', h: '40;40;35;30;30;35;35;35'
      },
      fontstyle: 'bold',
      align: 'center',
      aspect: '0.75',
      halo: '0',
      shadow: '2',
      penWidth: '1',
      isTextRec: '0'
    },
    {
      k: 'text',
      id: '#GAMED#',
      text: '',
      fill: WHITE,
      shadowColor: SHADOW,
      rect: { x: '540', y: '105;45;25;20;20;20;20;20', w: '47', h: '24;24;24;24;24;20' },
      fontstyle: 'bold',
      align: 'left',
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
      rect: {
        x: '590;590;590;590;590;585', y: '105;45;25;20;20;20;20;20',
        w: '50', h: '20;20;20;20;20;18'
      },
      fontstyle: 'bold',
      align: 'left',
      aspect: '0.75',
      isTextRec: '0'
    },
    {
      k: 'text',
      id: '#GAMEMODE#',
      text: '',
      rect: { x: '540', y: '80;20;5;5;5;5;5;5', w: '90', h: '24;24;15;15;15;15;15;15' },
      align: 'left',
      aspect: '0.75',
      isTextRec: '1'
    }
  ];

  // --- Viking2001_CommonInfoAddon.xml ------------------------------------
  var commonInfoAddon = [{
    k: 'picture',
    id: '#IS_REDPIN#',
    file: OBJECTS_DIR + 'RedPin.png',
    rect: { x: '530', y: '79;19;5;4', w: '90', h: '24;24;15;15;15;15;15;15' }
  }];

  // --- Viking2001_TeamInfo.xml, <bottom_panel_1> -------------------------
  // The team-sums strip under the sheet: the running total of every player on
  // the lane, frame by frame. Gated by #TFSUM#, which resolves empty unless the
  // lane sum is in use - see calcStatusLine in vbstokens.js.
  //
  // The x positions lean on two vbsrender behaviours that were already there:
  // ";" selects by player count, and "+=" adds to whatever the previous element
  // left in that field, so frames 4..10 each step on from frame 3. Text
  // attributes are inherited the same way, from #TFSUM# down through every
  // #FSUM_HCP_n# after it - which is why those carry nothing but a rect.
  var teamSumsPanel = {
    id: '#TFSUM#',
    y_generate: 70,
    elements: [{
      k: 'picture',
      file: 'Viking2001_Team_Sums1-5.png;Viking2001_Team_Sums1-5.png;' +
        'Viking2001_Team_Sums1-5.png;Viking2001_Team_Sums1-5.png;' +
        'Viking2001_Team_Sums1-5.png;Viking2001_Team_Sums6-8.png;' +
        'Viking2001_Team_Sums6-8.png;Viking2001_Team_Sums6-8.png',
      rect: { x: '15', y: '5', w: '610', h: '60' },

      layer_before_1: [
        {
          k: 'rect',
          rect: { x: '0', y: '1', w: '610', h: '30' },
          color: { trans: '125', red: '25', green: '25', blue: '25' }
        },
        {
          k: 'gradient',
          mode: '1',
          p1: { x: '0', y: '0', color: { trans: '255', red: '255', green: '255', blue: '10' } },
          p2: { x: '304', y: '20', color: { trans: '255', red: '255', green: '75', blue: '0' } },
          rect: { x: '0', y: '31', w: '610', h: '30' }
        }
      ],

      layer_after_1: [
        {
          k: 'text',
          id: '#LANE_TEAMNAME#',
          text: 'Lagnamn',
          font: 'Arial',
          fill: BLACK,
          rect: { x: '4', y: '32', w: '175', h: '26' },
          fontstyle: 'bold',
          align: 'left',
          aspect: '0.75',
          halo: '0',
          shadow: '0',
          penWidth: '0',
          isTextRec: '1'
        },
        {
          k: 'text',
          id: '#TFSUM#',
          text: '',
          rect: { x: '1', y: '3', w: '116;116;116;116;116;105', h: '22' },
          fill: { trans: '255', red: '250', green: '250', blue: '250' },
          shadowColor: BLACK,
          fontstyle: 'bold',
          align: 'center',
          aspect: '0.75',
          halo: '0',
          shadow: '2',
          isTextRec: '0'
        },
        {
          k: 'text', id: '#FSUM_HCP_1#',
          rect: { x: '15;15;15;15;15;112', w: '0;0;0;0;0;36', h: '22' }
        },
        {
          k: 'text', id: '#FSUM_HCP_2#',
          rect: { x: '73;73;73;73;73;160', w: '0;0;0;0;0;36', h: '22' }
        },
        {
          k: 'text', id: '#FSUM_HCP_3#',
          rect: { x: '117;117;117;117;117;208', w: '58;58;58;58;58;36', h: '22' }
        },
        { k: 'text', id: '#FSUM_HCP_4#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        { k: 'text', id: '#FSUM_HCP_5#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        { k: 'text', id: '#FSUM_HCP_6#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        { k: 'text', id: '#FSUM_HCP_7#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        { k: 'text', id: '#FSUM_HCP_8#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        { k: 'text', id: '#FSUM_HCP_9#', text: '', rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48' } },
        {
          k: 'text', id: '#FSUM_HCP_10#', text: '',
          rect: { x: '+=58;+=58;+=58;+=58;+=58;+=48', w: '86;86;86;86;86;60' }
        }
      ]
    }]
  };

  // --- Viking2001_TeamInfo.xml, layer_after_9 only -----------------------
  var teamName = [{
    k: 'text',
    id: '#LANE_TEAMNAME#',
    text: 'Lagnamn',
    font: 'Arial',
    fill: WHITE,
    shadowColor: SHADOW,
    rect: { x: '74', y: '39;39;27;12;12;12;12;7', w: '175', h: '26' },
    fontstyle: 'bold',
    align: 'left',
    aspect: '0.75',
    halo: '0',
    shadow: '2',
    penWidth: '0',
    isTextRec: '1'
  }];

  window.VBS_PROTOCOL_VIKING = {
    name: 'Viking',
    imagePath: PROTOCOL_DIR,
    imageSize: IMAGE_SIZE,
    x_generate: 640,
    y_generate: 480,
    y_start: '152;110;80;65;65;65;65;60',

    layer_before_1: header().concat(playTime()),

    active_player: activePlayer,
    inactive_player: inactivePlayer,

    layer_after_1: commonInfo,
    layer_after_2: commonInfoAddon,
    layer_after_9: teamName,

    bottom_panel_1: teamSumsPanel
  };
}());
