const express = require("express");
const morgan = require("morgan");
const querystring = require("querystring");
const axios = require("axios");
const app = express();
const stravaAuthUrl = "https://www.strava.com/oauth/authorize";
const clientId = 29349;
const redirectUri = "http://localhost:3001/strava/redirect";
const stravaPostUrl = "https://www.strava.com/oauth/token";
const yaml = require("js-yaml");
const fs = require("fs");

let scope = "";
let clientSecret = "";
let accessToken = "";
let refreshToken = "";

let tokenExpiration = 0; //Time since epoch in seconds. Time when access token expires

Object.assign = require("object-assign");

app.engine("html", require("ejs").renderFile);
app.use(morgan("combined"));

var port = process.env.PORT || process.env.OPENSHIFT_NODEJS_PORT || 8080,
  ip = process.env.IP || process.env.OPENSHIFT_NODEJS_IP || "0.0.0.0",
  mongoURL = process.env.OPENSHIFT_MONGODB_DB_URL || process.env.MONGO_URL,
  mongoURLLabel = "";

if (mongoURL == null) {
  var mongoHost, mongoPort, mongoDatabase, mongoPassword, mongoUser;
  // If using plane old env vars via service discovery
  if (process.env.DATABASE_SERVICE_NAME) {
    var mongoServiceName = process.env.DATABASE_SERVICE_NAME.toUpperCase();
    mongoHost = process.env[mongoServiceName + "_SERVICE_HOST"];
    mongoPort = process.env[mongoServiceName + "_SERVICE_PORT"];
    mongoDatabase = process.env[mongoServiceName + "_DATABASE"];
    mongoPassword = process.env[mongoServiceName + "_PASSWORD"];
    mongoUser = process.env[mongoServiceName + "_USER"];

    // If using env vars from secret from service binding
  } else if (process.env.database_name) {
    mongoDatabase = process.env.database_name;
    mongoPassword = process.env.password;
    mongoUser = process.env.username;
    var mongoUriParts = process.env.uri && process.env.uri.split("//");
    if (mongoUriParts.length == 2) {
      mongoUriParts = mongoUriParts[1].split(":");
      if (mongoUriParts && mongoUriParts.length == 2) {
        mongoHost = mongoUriParts[0];
        mongoPort = mongoUriParts[1];
      }
    }
  }

  if (mongoHost && mongoPort && mongoDatabase) {
    mongoURLLabel = mongoURL = "mongodb://";
    if (mongoUser && mongoPassword) {
      mongoURL += mongoUser + ":" + mongoPassword + "@";
    }
    // Provide UI label that excludes user id and pw
    mongoURLLabel += mongoHost + ":" + mongoPort + "/" + mongoDatabase;
    mongoURL += mongoHost + ":" + mongoPort + "/" + mongoDatabase;
  }
}
var db = null,
  dbDetails = new Object();

var initDb = function (callback) {
  if (mongoURL == null) return;

  var mongodb = require("mongodb");
  if (mongodb == null) return;

  mongodb.connect(mongoURL, function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    db = conn;
    dbDetails.databaseName = db.databaseName;
    dbDetails.url = mongoURLLabel;
    dbDetails.type = "MongoDB";

    console.log("Connected to MongoDB at: %s", mongoURL);
  });
};

app.get("/", function (req, res) {
  // try to initialize the db on every request if it's not already
  // initialized.
  if (!db) {
    initDb(function (err) {});
  }
  if (db) {
    var col = db.collection("counts");
    // Create a document with request IP and current time of request
    col.insert({ ip: req.ip, date: Date.now() });
    col.count(function (err, count) {
      if (err) {
        console.log("Error running count. Message:\n" + err);
      }
      res.render("index.html", { pageCountMessage: count, dbInfo: dbDetails });
    });
  } else {
    res.render("index.html", { pageCountMessage: null });
  }
});

app.get("/pagecount", function (req, res) {
  // try to initialize the db on every request if it's not already
  // initialized.
  if (!db) {
    initDb(function (err) {});
  }
  if (db) {
    db.collection("counts").count(function (err, count) {
      res.send("{ pageCount: " + count + "}");
    });
  } else {
    res.send("{ pageCount: -1 }");
  }
});

app.get("/test", (req, res) => res.send("Hello World!"));

app.get("/auth", (req, res) => {
  console.log("Received auth request");

  //If refresh token present and access token expired, get a new access token. Else, redirect to strava oauth page to get a token
  if (refreshToken !== "" && tokenExpiration < new Date().getTime()) {
    console.log("Access token expired, getting new one");
    res.redirect(redirectUri);
  } else {
    console.log("No access token, redirecting to strava oauth page");
    const stravaAuthUrlWithParams =
      stravaAuthUrl +
      "?" +
      querystring.encode({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "read",
      });
    res.redirect(stravaAuthUrlWithParams);
  }
});

app.get("/strava/redirect", (req, res) => {
  console.log(req.query);
  scope = req.query.scope; //Update current scope

  try {
    const doc = yaml.safeLoad(fs.readFileSync("./secret.yml", "utf8"));
    clientSecret = doc["secret"];
  } catch (e) {
    console.log(e);
  }

  let tokenParams = { client_id: clientId, client_secret: clientSecret };

  if (req.query) {
    tokenParams.code = req.query.code;
    tokenParams.grant_type = "authorization_code";
  } else if (refreshToken) {
    tokenParams.refresh_token = refreshToken;
    tokenParams.grant_type = "refresh_token";
  } else {
    res.redirect("http://localhost:3000");
  }

  //Send HTTP Post request to URL specified in Strava docs to get token
  axios
    .post(stravaPostUrl, tokenParams)
    .then((res2) => {
      console.log(res2);
      //Get and store access token, expiration time, refresh token from response
      accessToken = res2.data.access_token;
      tokenExpiration = res2.data.expires_at;
      refreshToken = res2.data.refresh_token;
    })
    .catch(function (error) {
      console.log(error);
    })
    .finally(() => {
      //Redirect back to homepage? TODO
      res.redirect("http://localhost:3000");
    });
});

// error handling
app.use(function (err, req, res, next) {
  console.error(err.stack);
  res.status(500).send("Something bad happened!");
});

initDb(function (err) {
  console.log("Error connecting to Mongo. Message:\n" + err);
});

app.listen(port, ip);
console.log("RunRunRun backend app running on http://%s:%s", ip, port);

module.exports = app;
