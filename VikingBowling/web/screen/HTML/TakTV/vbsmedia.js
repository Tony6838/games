// ---------------------------------------------------------------------------
// vbsmedia.js - the picture and video layer over the rendered sheet, plus the
// banner strip and the clock.
//
// Shared by every HTML screen: the lane TV (TakTV.html) and the info TV
// (..\info\info.html) both load this one file rather than carrying a copy each.
// That is deliberate. Both screens spend most of their time showing exactly the
// same things from exactly the same folders - the commercials, the animations,
// the slow-waiting media, "nothing to play" - and the awkward parts of doing so
// (a video that must not be interrupted by the next payload but must yield to
// a lane being switched on, a repeat that must not restart, an image whose
// file name never changes while its contents do) are the same awkward parts on
// both. Two copies would drift, and the one that drifted would be the one
// nobody was looking at.
//
// Straight port of playMedia / displayImageFx / displayVideoFx / playBottomText
// / display_time in ..\..\common\js\commonAPI.js, which is what the XML screens
// run. Same de-duplication, same "a video wins until it ends or the lane
// status moves on", same cache-busting index on a regenerated .xml.jpg. Three
// differences, all forced by these screens drawing their content instead of
// fetching it as a picture:
//
//  1. VBS_SHEET is a pseudo-media. "Show what this page drew" goes through
//     vbsPlayMedia like any other media, so it gets the same de-duplication and
//     is queued behind a playing video in the same way. The XML screens have no
//     equivalent because their sheet *is* a picture.
//  2. What the picture layer should be showing is remembered (vbsMediaUnder), so
//     when a video ends the layer goes back to it. commonAPI simply un-hides the
//     <img>, which is right there - the layer always holds a picture - and wrong
//     here, where it would drop a stale commercial over the drawn sheet.
//  3. No jQuery. commonAPI needs it for its ajax defaults and its 1 Hz timer;
//     this file touches neither, and the HTML screens do not load jQuery at all.
//
// The banner strip and the clock are optional: the lane TV has both, the info TV
// has neither, and a page that lacks the element simply gets nothing rather than
// a thrown error.
// ---------------------------------------------------------------------------

/* exported VBS_SHEET, vbsPlayMedia, vbsShowSheet, vbsPlayBottomText,
   vbsSetLaneStatus, vbsCurrentLaneStatus, vbsDisplayTime */

// "Show the sheet this page drew." Passed to vbsPlayMedia with a stamp appended
// - the lane data's modification time, the info screen's media name - so a new
// sheet is a new media string and is not dropped as a repeat. It must contain
// none of the extensions tested below, or it would be taken for a file.
var VBS_SHEET = '#sheet#';

// The lane status the media layer last saw. Owned here rather than by the page
// because vbsPlayMedia has to know whether the status changed - that is what
// makes a repeated media play again after a detour through a commercial - and
// commonAPI's isLaneStatusChanged owned it for the same reason. A page reads it
// with vbsCurrentLaneStatus and records a status that no media call reached with
// vbsSetLaneStatus. Starts on 'Commercial', as commonAPI's oldLaneStatus does.
var vbsMediaLaneStatus = 'Commercial';

var vbsMediaLast = '';        // last media string handed to vbsPlayMedia
var vbsMediaUnder = '';       // what the picture layer holds: a URL, or VBS_SHEET
var vbsMediaPending = '';     // arrived while a video was playing; shown when it ends
var vbsMediaVideoPlaying = false;
var vbsMediaVideoStatus = ''; // lane status the video in #videoFx was started under
var vbsMediaIndex = 0;        // cache-buster for a regenerated .xml.jpg / .txt.jpg

function vbsCurrentLaneStatus() {
  return vbsMediaLaneStatus;
}

function vbsSetLaneStatus(status) {
  vbsMediaLaneStatus = status;
}

function vbsMediaStatusChanged(status) {
  if (vbsMediaLaneStatus === status) return false;
  vbsMediaLaneStatus = status;
  return true;
}

// Looked up per call rather than cached at parse time: this file is loaded with
// the rest of the page's scripts and a page need not have every element.
function vbsMediaPicture() {
  return document.getElementById('imageFx');
}

// Shows one media, or the drawn sheet.
//
// Returns true when it acted and undefined when it dropped a repeat - which is
// what the lane TV's "StartConsole is already up, so start counting towards the
// slow-waiting media" test reads, exactly as it did on the XML screen.
function vbsPlayMedia(media, status) {
  var statusChanged = vbsMediaStatusChanged(status);

  if (vbsMediaLast !== media)
    vbsMediaLast = media;
  else if (!statusChanged)
    return;

  if (media.indexOf(VBS_SHEET) === 0)
    vbsShowSheet(status);
  else if (media.indexOf('.jpg') > 0 || media.indexOf('.png') > 0)
    vbsDisplayImageFx(media, status);
  else if (media.indexOf('.webm') > 0 || media.indexOf('.mp4') > 0)
    vbsDisplayVideoFx(media, status);

  return true;
}

// Uncovers the SVG the page drew, by taking the picture layer away. Public
// because a page may want the sheet back without going through the media
// de-duplication - after a render that changed nothing, a media call would see
// the same string and drop it. The status is the lane status the sheet belongs
// to; a caller that leaves it out keeps a playing video's claim on the screen.
function vbsShowSheet(status) {
  vbsMediaYieldVideo(status);
  if (vbsMediaVideoPlaying) {
    vbsMediaPending = VBS_SHEET;
    return;
  }

  vbsMediaRemoveVideo();

  var picture = vbsMediaPicture();
  if (picture) picture.hidden = true;

  vbsMediaUnder = VBS_SHEET;
}

function vbsDisplayImageFx(source, status) {
  // The info images keep their file name and have their contents rewritten -
  // Commercial.exe redraws HiScoreDay.xml.jpg whenever a score is registered and
  // Result1002.xml.jpg whenever a serie ends - so without this the screen shows
  // whichever version the browser cached first, for the rest of the day.
  if ((source.indexOf('.xml.jpg') >= 0 || source.indexOf('.txt.jpg') >= 0) && source.indexOf('?index=') < 0)
    source += '?index=' + vbsMediaIndex++;

  vbsMediaYieldVideo(status);
  if (vbsMediaVideoPlaying) {
    vbsMediaPending = source;
    return;
  }

  vbsMediaRemoveVideo();

  var picture = vbsMediaPicture();
  if (!picture) return;

  picture.hidden = false;
  picture.style.opacity = '100%';
  picture.setAttribute('src', source);

  // The resolved URL, index and all, so restoring the layer after a video does
  // not bump the index again and refetch a picture that is already there.
  vbsMediaUnder = source;
}

// Takes the video element down, playing or still loading, with its handlers
// detached first. A <video> removed from the page is not a dead one - it goes on
// loading, and its canplay would otherwise mark a video nobody can see as
// playing and hold every picture behind it until that video had ended.
function vbsMediaRemoveVideo() {
  var video = document.getElementById('videoFx');
  if (!video) return;

  video.oncanplay = null;
  video.onended = null;
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (video.parentNode) video.parentNode.removeChild(video);
}

// A video keeps the screen until it ends - as long as the lane is still in the
// state it was started in. That is what stops an animation being cut in half by
// the next payload. It does not hold across a change of lane status: a
// commercial was started while the lane was off, and once the lane has been
// switched on the bowlers are waiting for their sheet, not for the end of a
// two-minute film. So a video started under another status is cut the moment
// media for the new status arrives, and the new media shows at once. Whatever
// was queued behind the video belonged to the old status and goes with it.
function vbsMediaYieldVideo(status) {
  if (!vbsMediaVideoPlaying || status === undefined || vbsMediaVideoStatus === status) return;

  vbsMediaRemoveVideo();
  vbsMediaVideoPlaying = false;
  vbsMediaPending = '';
}

function vbsDisplayVideoFx(source, status) {
  // A video owns the screen until it ends, unless the lane has moved on to
  // another status meanwhile - see vbsMediaYieldVideo. Anything else that
  // arrives is held in vbsMediaPending and shown after - the same rule
  // commonAPI applies, and the reason an animation is never cut in half by the
  // next payload.
  vbsMediaYieldVideo(status);
  if (vbsMediaVideoPlaying) return;

  var picture = vbsMediaPicture();

  // A commercial video replaces the picture outright; an animation plays over
  // whatever is underneath, which is how the XML screen shows one over the
  // scoresheet.
  if (status === 'Commercial' && picture) picture.hidden = true;

  var video = document.getElementById('videoFx');

  if (video === null) {
    var host = document.getElementById('main_content');
    if (!host) return;

    video = document.createElement('video');
    video.id = 'videoFx';
    video.muted = true;
    video.playsInline = true;
    host.appendChild(video);
  }

  vbsMediaVideoStatus = status;
  video.setAttribute('src', source);
  video.style.opacity = '100%';
  video.load();

  video.oncanplay = function () {
    vbsMediaVideoPlaying = true;
    video.play();

    video.onended = function () {
      vbsMediaRemoveVideo();
      vbsMediaVideoPlaying = false;
      vbsMediaRestoreLayer();
    };
  };
}

// What the picture layer shows once a video has finished: whatever arrived while
// it was playing, or else whatever the layer held before it started.
//
// The second half is where this differs from commonAPI, which un-hides the <img>
// unconditionally. On a screen that draws its own sheet that would put the last
// commercial back over it and leave it there until the next media change.
function vbsMediaRestoreLayer() {
  var restore = vbsMediaPending || vbsMediaUnder;
  vbsMediaPending = '';

  if (restore === VBS_SHEET) vbsShowSheet();
  else if (restore) vbsDisplayImageFx(restore);
}

// The text strip under the media area. A page without the element - the info TV
// has no banner strip - gets nothing.
var vbsMediaBanner = null;

function vbsPlayBottomText(text) {
  if (text === undefined || text === null) return;
  if (vbsMediaBanner === text) return;

  var element = document.getElementById('bannerText');
  if (!element) return;

  element.innerHTML = text;
  vbsMediaBanner = text;
}

function vbsDisplayTime() {
  var element = document.getElementById('clock');
  if (!element) return;

  var now = new Date();
  var hour = now.getHours();
  var minute = now.getMinutes();
  var second = now.getSeconds();

  if (hour < 10) hour = '0' + hour;
  if (minute < 10) minute = '0' + minute;
  if (second < 10) second = '0' + second;

  element.innerHTML = ' ' + hour + ':' + minute + ':' + second;
}
