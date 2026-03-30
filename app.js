/**
 * Intelligent Traffic Control Dashboard — Application Logic
 * State machine for two intersections (North–South, East–West) with safe
 * transitions and race-condition protection. Uses async/await and the
 * Event Loop for non-blocking timing.
 */

/* ========== STATE OBJECT ==========
 * Single source of truth. Only these values drive the UI and transition logic.
 * Invariant: Never both NS and EW green or yellow at the same time.
 */
const trafficSystem = {
  northSouth: 'green',   // 'green' | 'yellow' | 'red'
  eastWest: 'red',       // 'green' | 'yellow' | 'red'
  pedestrian: 'red',     // 'green' | 'yellow' | 'red'
  transitionInProgress: false  // Guards against overlapping transitions (race condition)
};

/** DOM element references — populated in init() after DOM is ready */
let transitionBtn = null;
let pedestrianBtn = null;
let logList = null;
let colorButtons = [];

/** Light element maps: direction -> { red, yellow, green } for classList.toggle */
const lightElements = {
  ns: { red: null, yellow: null, green: null },
  ew: { red: null, yellow: null, green: null },
  ped: { red: null, yellow: null, green: null }
};

/* ========== updateUI() ==========
 * Control Flow: Reads trafficSystem state and syncs the DOM. Uses classList.toggle
 * to add/remove the "on" class so only the active light per pole appears lit.
 * Event Loop: This runs synchronously; it does not schedule any microtasks or
 * macrotasks. Called after every state change so the UI always reflects state.
 */
function updateUI() {
  const ns = trafficSystem.northSouth;
  const ew = trafficSystem.eastWest;
  const ped = trafficSystem.pedestrian;

  if (lightElements.ns.red) {
    lightElements.ns.red.classList.toggle('on', ns === 'red');
    lightElements.ns.yellow.classList.toggle('on', ns === 'yellow');
    lightElements.ns.green.classList.toggle('on', ns === 'green');
  }
  if (lightElements.ew.red) {
    lightElements.ew.red.classList.toggle('on', ew === 'red');
    lightElements.ew.yellow.classList.toggle('on', ew === 'yellow');
    lightElements.ew.green.classList.toggle('on', ew === 'green');
  }
  if (lightElements.ped.red) {
    lightElements.ped.red.classList.toggle('on', ped === 'red');
    lightElements.ped.yellow.classList.toggle('on', ped === 'yellow');
    lightElements.ped.green.classList.toggle('on', ped === 'green');
  }
}

/* ========== logEvent() ==========
 * Control Flow: Appends a timestamped message to the System Logs list. Runs
 * synchronously. Used to record state changes for debugging and education.
 */
function logEvent(message) {
  if (!logList) return;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  li.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

/* ========== transitionLights() ==========
 * Async function that performs one full transition cycle with Yellow buffer.
 * Control Flow:
 *   1. If a transition is already running, return immediately (race protection).
 *   2. Set transitionInProgress = true so further clicks are ignored.
 *   3. If NS is green: NS -> Yellow (3s) -> Red, wait 1s, then EW -> Green.
 *   4. If EW is green: EW -> Yellow (3s) -> Red, wait 1s, then NS -> Green.
 *   5. Clear transitionInProgress and re-enable the button.
 * Event Loop: Each await yields to the event loop; after the timeout, the
 * engine resumes this function. This prevents blocking the main thread while
 * waiting. No two lights are ever Green or Yellow at the same time because
 * we only set one direction to green after the other is fully red + 1s buffer.
 */
async function transitionLights() {
  if (trafficSystem.transitionInProgress) {
    logEvent('Ignored: transition already in progress.');
    return;
  }

  trafficSystem.transitionInProgress = true;
  if (transitionBtn) transitionBtn.disabled = true;
  if (pedestrianBtn) pedestrianBtn.disabled = true;
  logEvent('Transition started.');

  try {
    if (trafficSystem.northSouth === 'green') {
      // NS was green -> turn NS yellow, then red, then EW green
      trafficSystem.northSouth = 'yellow';
      trafficSystem.eastWest = 'red';
      updateUI();
      logEvent('N-S → Yellow (buffer 3s).');

      await new Promise(resolve => setTimeout(resolve, 3000)); // 3s yellow buffer

      trafficSystem.northSouth = 'red';
      updateUI();
      logEvent('N-S → Red.');

      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s all-red buffer

      trafficSystem.eastWest = 'green';
      updateUI();
      logEvent('E-W → Green.');
    } else if (trafficSystem.eastWest === 'green') {
      // EW was green -> turn EW yellow, then red, then NS green
      trafficSystem.eastWest = 'yellow';
      trafficSystem.northSouth = 'red';
      updateUI();
      logEvent('E-W → Yellow (buffer 3s).');

      await new Promise(resolve => setTimeout(resolve, 3000));

      trafficSystem.eastWest = 'red';
      updateUI();
      logEvent('E-W → Red.');

      await new Promise(resolve => setTimeout(resolve, 1000));

      trafficSystem.northSouth = 'green';
      updateUI();
      logEvent('N-S → Green.');
    }
    logEvent('Transition complete.');
  } finally {
    trafficSystem.transitionInProgress = false;
    if (transitionBtn) transitionBtn.disabled = false;
    if (pedestrianBtn) pedestrianBtn.disabled = false;
  }
}

/* ========== handleLogic() ==========
 * Event handler for the "Switch Direction" button. Control Flow: Called by the
 * Event Loop when the user clicks (macrotask). It does not block; it starts
 * transitionLights() which uses async/await and yields during waits. Clicks
 * during transition are ignored because transitionLights() returns early when
 * transitionInProgress is true, and the button is disabled during transition.
 */
function handleLogic() {
  transitionLights();
}

/* ========== runPedestrianSequence() ==========
 * Async sequence for pedestrian crossing:
 *   - Starts from current vehicle state; brings any green direction safely to red.
 *   - Total time ~7 seconds from button press until pedestrian green.
 *   - First ~3s: whichever vehicle direction is green turns yellow then red.
 *   - Next 4s: pedestrian shows yellow countdown, then turns green once both
 *     vehicle directions are fully red.
 * Event Loop: Uses await with setTimeout-based Promises to yield control while
 * waiting so the UI stays responsive.
 */
async function runPedestrianSequence() {
  if (trafficSystem.transitionInProgress) {
    logEvent('Ignored pedestrian request: transition already in progress.');
    return;
  }

  trafficSystem.transitionInProgress = true;
  if (transitionBtn) transitionBtn.disabled = true;
  if (pedestrianBtn) pedestrianBtn.disabled = true;
  logEvent('Pedestrian request received.');

  try {
    // Phase 1 (~3s): bring any green vehicle direction to red.
    if (trafficSystem.eastWest === 'green') {
      trafficSystem.eastWest = 'yellow';
      trafficSystem.pedestrian = 'red';
      updateUI();
      logEvent('Pedestrian phase: E-W → Yellow (3s).');

      await new Promise(resolve => setTimeout(resolve, 3000));

      trafficSystem.eastWest = 'red';
      updateUI();
      logEvent('Pedestrian phase: E-W → Red.');
    } else if (trafficSystem.northSouth === 'green') {
      trafficSystem.northSouth = 'yellow';
      trafficSystem.pedestrian = 'red';
      updateUI();
      logEvent('Pedestrian phase: N-S → Yellow (3s).');

      await new Promise(resolve => setTimeout(resolve, 3000));

      trafficSystem.northSouth = 'red';
      updateUI();
      logEvent('Pedestrian phase: N-S → Red.');
    } else {
      // Already all red; just wait 3s to preserve overall timing.
      trafficSystem.pedestrian = 'red';
      updateUI();
      logEvent('Pedestrian phase: vehicles already red, waiting 3s.');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Ensure both directions are hard red before granting walk.
    trafficSystem.northSouth = 'red';
    trafficSystem.eastWest = 'red';
    updateUI();

    // Phase 2 (4s): pedestrian yellow countdown then green.
    trafficSystem.pedestrian = 'yellow';
    updateUI();
    logEvent('Pedestrian → Yellow (4s before walk).');

    await new Promise(resolve => setTimeout(resolve, 4000));

    trafficSystem.pedestrian = 'green';
    updateUI();
    logEvent('Pedestrian → Green (walk). Both vehicle directions are Red.');
  } finally {
    trafficSystem.transitionInProgress = false;
    if (transitionBtn) transitionBtn.disabled = false;
    if (pedestrianBtn) pedestrianBtn.disabled = false;
  }
}

/* ========== handlePedestrianRequest() ==========
 * Click handler for the pedestrian button. Delegates to the async sequence
 * without blocking the main thread.
 */
function handlePedestrianRequest() {
  runPedestrianSequence();
}

/* ========== handleManualColor() ==========
 * Event handler for manual color buttons. Control Flow: Validates that we are
 * not mid-transition, preserves safety (won't allow two directions to be
 * green/yellow at once), updates state, then calls updateUI().
 * Event Loop: Called in response to a click event (macrotask). Runs
 * synchronously; does not block because it performs no waiting itself.
 */
function handleManualColor(direction, color) {
  if (trafficSystem.transitionInProgress) {
    logEvent('Ignored manual change: transition in progress.');
    return;
  }

  const isNorthSouth = direction === 'ns';
  const thisKey = isNorthSouth ? 'northSouth' : 'eastWest';
  const otherKey = isNorthSouth ? 'eastWest' : 'northSouth';

  // Safety: never allow both directions to be green or yellow at once.
  if ((color === 'green' || color === 'yellow') &&
      (trafficSystem[otherKey] === 'green' || trafficSystem[otherKey] === 'yellow')) {
    logEvent(`Ignored manual ${direction.toUpperCase()} ${color}: other direction not fully red.`);
    return;
  }

  trafficSystem[thisKey] = color;
  // Any vehicle non-red state should force pedestrians back to red for safety.
  if (color === 'green' || color === 'yellow') {
    trafficSystem.pedestrian = 'red';
  }
  updateUI();
  logEvent(`Manual override: ${direction.toUpperCase()} → ${color[0].toUpperCase()}${color.slice(1)}.`);
}

/* ========== init() ==========
 * Control Flow: Runs once when the script loads. DOM must be ready (script at
 * end of body). Binds DOM references, sets initial UI from trafficSystem, and
 * attaches the click listener. Event Loop: addEventListener registers a
 * callback; it does not run until the user clicks, at which point the loop
 * invokes handleLogic.
 */
function init() {
  transitionBtn = document.querySelector('#transition-btn');
  pedestrianBtn = document.querySelector('#pedestrian-btn');
  logList = document.querySelector('#log-list');
  colorButtons = Array.from(document.querySelectorAll('.color-btn'));

  lightElements.ns.red    = document.querySelector('#ns-red');
  lightElements.ns.yellow = document.querySelector('#ns-yellow');
  lightElements.ns.green  = document.querySelector('#ns-green');
  lightElements.ew.red    = document.querySelector('#ew-red');
  lightElements.ew.yellow = document.querySelector('#ew-yellow');
  lightElements.ew.green  = document.querySelector('#ew-green');
   lightElements.ped.red    = document.querySelector('#ped-red');
   lightElements.ped.yellow = document.querySelector('#ped-yellow');
   lightElements.ped.green  = document.querySelector('#ped-green');

  updateUI();
  logEvent('System ready. N-S Green, E-W Red.');

  if (transitionBtn) {
    transitionBtn.addEventListener('click', handleLogic);
  }
  if (pedestrianBtn) {
    pedestrianBtn.addEventListener('click', handlePedestrianRequest);
  }

  // Bind manual color buttons for each direction.
  colorButtons.forEach((btn) => {
    const dir = btn.getAttribute('data-dir');
    const color = btn.getAttribute('data-color');
    btn.addEventListener('click', () => handleManualColor(dir, color));
  });
}

/* Start the application when the script executes. */
init();
