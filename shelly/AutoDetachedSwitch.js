// --------------------- Shelly Plus Script ---------------------
// - (C): Juan Díez-Yanguas Barber 2024
// - Script to monitor Home Assistant Connection from Shelly devices.
// - When connection is ok switches can be set to detached switchs. On connection fail set switches in switch mode
// ---------------------------------------------------------------

let CONFIG = {
  endpoints: ["http://homeassistant.local/"],
  //number of failures that trigger the reset
  numberOfFails: 5,
  //time in seconds after which the http request is considered failed
  httpTimeout: 10,
  //time in seconds to retry a "ping"
  pingTime: 10
};

let endpointIdx = 0;
let failCounter = 0;
let pingTimer = null;

function setSwitchConfiguration(switchId, inMode){
  let switchConfig = {id: switchId, config: {in_mode: inMode}};
  Shelly.call("Switch.SetConfig", switchConfig,
    function(result){
      print("SetConfigResult Id: ", switchId, ": ", inMode, " | ", JSON.stringify(result));
    });
}

function processResultForSwitch(switchId, pingOk){
  Shelly.call("Switch.GetConfig", { id: switchId},
    function(config){
      let currentDetached = config.in_mode === "detached";
      let setConfig = (currentDetached && !pingOk) || (!currentDetached && pingOk);
      let setInMode = pingOk ? "detached" : "flip";
      if(setConfig){
        setSwitchConfiguration(switchId, setInMode);
      }
    }
  );
}

function processPingResult(pingOk){
  processResultForSwitch(0, pingOk);
  processResultForSwitch(1, pingOk);
}

function onPingResponse(response, error_code, error_message){
  print("Ping Completed to ", CONFIG.endpoints[endpointIdx], "-->", error_code);
  //http timeout, magic number, not yet documented
  if (error_code === -114 || error_code === -104) {
    print("Failed to fetch ", CONFIG.endpoints[endpointIdx]);
    failCounter++;
    print("Rotating through endpoints");
    endpointIdx++;
    endpointIdx = endpointIdx % CONFIG.endpoints.length;
  } else {
    failCounter = 0;
    processPingResult(true);
  }
  
  if (failCounter >= CONFIG.numberOfFails) {
    print("Too many fails");
    failCounter = 0;
    processPingResult(false);
  }
}

function pingEndpoints() {
  Shelly.call(
    "http.get",
    { url: CONFIG.endpoints[endpointIdx], timeout: CONFIG.httpTimeout },
    onPingResponse);
}

print("Start watchdog timer");
pingTimer = Timer.set(CONFIG.pingTime * 1000, true, pingEndpoints);

Shelly.addStatusHandler(function (status) {
  print(JSON.stringify(status));
  //is the component a switch
  if(status.name !== "switch") return;
  //is it the one with id 0
  if(status.id !== 0) return;
  //does it have a delta.source property
  if(typeof status.delta.source === "undefined") return;
  //is the source a timer
  if(status.delta.source !== "timer") return;
  //is it turned on
  if(status.delta.output !== true) return;
  //start the loop to ping the endpoints again
  pingTimer = Timer.set(CONFIG.pingTime * 1000, true, pingEndpoints);
});
