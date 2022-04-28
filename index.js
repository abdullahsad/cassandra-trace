var express = require('express');
const Pusher = require("pusher");
const bodyParser = require("body-parser");
const cors = require("cors");
var dayjs = require('dayjs')
var app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
var models = require('express-cassandra');
var createError = require('http-errors');
//import dayjs from 'dayjs' // ES 2015
var geojsonLength = require('geojson-length');


const {setGpx, sanitize} =  require('./GpxSanitizer');
const pusher = new Pusher({
    appId: "1004",
    key: "a1975a97bf741bbb1004",
    secret: "7cfe0b6f0c4adbcd1004",
    cluster: "ap1",
    host: "socket.bmapsbd.com",
    port: 8005,
    useTLS: false,
});
// Tell express-cassandra to use the models-directory, and
// use bind() to load the models using cassandra configurations.
models.setDirectory( __dirname + '/models').bind(
    {
        clientOptions: {
            contactPoints: ['127.0.0.1'],
            localDataCenter: 'datacenter1',
            protocolOptions: { port: 9042 },
            keyspace: 'test_3',
            queryOptions: {consistency: models.consistencies.one}
        },
        ormOptions: {
            defaultReplicationStrategy : {
                class: 'SimpleStrategy',
                replication_factor: 1
            },
            migration: 'safe'
        }
    },
    function(err) {
        if(err) throw err;
    }
);

app.get('/person/:name/:surname/:age', function(req, res) {
    res.send('name: ' + req.params.name+', surname:'+req.params.surname+', age:'+req.params.age);
    var person = new models.instance.Person({
        name: req.params.name,
        surname: req.params.surname,
        age: parseInt(req.params.age),
        created: Date.now()
    });
    person.save(function(err){
        if(err) {
            console.log(err);
            return;
        }
        console.log('person saved!');
    });
});

app.get('/test', function(req, res) {
    // var query = "SELECT * FROM gpx where user_id = 2869 ALLOW FILTERING;";
    // var q = "INSERT INTO person (name,surname,age,created) VALUES ('t1','test',18,'2022-04-13T06:44:17.010Z'),('t2','test',18,'2022-04-13T06:44:17.010Z'),('t3','test',18,'2022-04-13T06:44:17.010Z') ALLOW FILTERING;";
    // models.instance.Person.execute_query(q, {}, function(err, Conversations){
    //     // res.send(JSON.stringify(Conversations));
    //     res.send(err);
    // });
    // var queries = [];
    // var data = JSON.parse(req.body.gpx_bulk);

    // for (let i = 0; i < data.length; i++) {
    //     var tmp_gpx = new models.instance.Gpx({
    //         user_id:parseInt(data[i].user_id),
    //         longitude:parseFloat(data[i].longitude),
    //         latitude:parseFloat(data[i].latitude),
    //         speed:parseFloat(data[i].speed),
    //         bearing:parseFloat(data[i].bearing),
    //         created_at: Date.now(),
    //         updated_at: Date.now(),
    //         altitude:parseFloat(data[i].altitude),
    //         gpx_time:data[i].gpx_time,
    //         is_offline_data:1,
    //         accuracy:parseFloat(data[i].accuracy),
    //         company_id:parseInt(data[i].company_id),
    //         service:data[i].service
    //     });
    //     var save_query = tmp_gpx.save({return_query: true});
    //     queries.push(save_query);
    // }
    // models.doBatch(queries, function(err,res){
    //     if(err) throw err;
    // });
    // res.send('offline gpx added!');
    // var queries = [];

    // var event = new models.instance.Person({
    //     name : "t2",
    //     surname : "text",
    //     age	 : 18,
    //     created : "2022-04-13T06:44:17.010Z"
    // });
    // var save_query = event.save({return_query: true});
    // queries.push(save_query);

    // var update_query = models.instance.Person.update(
    //     {name: 'saad2'},
    //     {surname: 'hello1 updated'},
    //     {return_query: true}
    // );
    // queries.push(update_query);

    // var delete_query = models.instance.Person.delete(
    //     {name: 't1'},
    //     {return_query: true}
    // );
    // queries.push(delete_query);

    // models.doBatch(queries, function(err,res){
    //     if(err) throw err;
    //     else
    //         console.log(res);
    // });

    
      
      pusher.trigger("private-my-channel", "my-event", {
        message: "hello world",
      });
      res.send('gpx added!');

});

app.post('/gpx-bulk-insert', function(req, res) {
    // var query = "SELECT * FROM gpx where user_id = 2869 ALLOW FILTERING;";
    // var q = "INSERT INTO person (name,surname,age,created) VALUES ('t1','test',18,'2022-04-13T06:44:17.010Z'),('t2','test',18,'2022-04-13T06:44:17.010Z'),('t3','test',18,'2022-04-13T06:44:17.010Z') ALLOW FILTERING;";
    // models.instance.Person.execute_query(q, {}, function(err, Conversations){
    //     // res.send(JSON.stringify(Conversations));
    //     res.send(err);
    // });
    var queries = [];
    var data = JSON.parse(req.body.gpx_bulk);
    // res.send(data);
    for (let i = 0; i < data.length; i++) {
        var tmp_gpx = new models.instance.Gpx({
            user_id:parseInt(data[i].user_id),
            longitude:parseFloat(data[i].longitude),
            latitude:parseFloat(data[i].latitude),
            speed:parseFloat(data[i].speed),
            bearing:parseFloat(data[i].bearing),
            created_at: Date.now(),
            updated_at: Date.now(),
            altitude:data[i].altitude ? parseFloat(data[i].altitude) : 0.0,
            gpx_time:data[i].gpx_time,
            is_offline_data:1,
            accuracy:data[i].accuracy ? parseFloat(data[i].accuracy) : 0.0,
            company_id:1,
            service:'RETAIL_TRACE'
        });
        var save_query = tmp_gpx.save({return_query: true});
        queries.push(save_query);
    }
    models.doBatch(queries, function(err,res){
        if(err) throw err;
    });
    res.send('offline gpx added!');
    // var queries = [];

    // var event = new models.instance.Person({
    //     name : "t2",
    //     surname : "text",
    //     age	 : 18,
    //     created : "2022-04-13T06:44:17.010Z"
    // });
    // var save_query = event.save({return_query: true});
    // queries.push(save_query);

    // var update_query = models.instance.Person.update(
    //     {name: 'saad2'},
    //     {surname: 'hello1 updated'},
    //     {return_query: true}
    // );
    // queries.push(update_query);

    // var delete_query = models.instance.Person.delete(
    //     {name: 't1'},
    //     {return_query: true}
    // );
    // queries.push(delete_query);

    // models.doBatch(queries, function(err,res){
    //     if(err) throw err;
    //     else
    //         console.log(res);
    // });

});

app.post('/add-gpx', function(req, res) {
    const { user_id, longitude, latitude , speed , bearing , altitude , gpx_time , is_offline_data , accuracy , company_id , service } = req.body;

    // if (!(user_id && longitude && latitude && speed && bearing && altitude && gpx_time && is_offline_data && accuracy && company_id && service)) {
    //     res.status(400).send("All input is required");
    // }
    var gpx = new models.instance.Gpx({
        user_id: user_id,
        longitude: longitude,
        latitude: latitude,
        speed: speed,
        bearing: bearing,
        created_at: Date.now(),
        updated_at: Date.now(),
        altitude: altitude,
        gpx_time: gpx_time,
        is_offline_data: is_offline_data,
        accuracy: accuracy,
        company_id: company_id,
        service: service
    });
    gpx.save(function(err){
        if(err) {
            console.log(err);
            return;
        }
        console.log('gpx saved!');
        res.send('gpx added!');
    });


});


app.post("/pusher/auth", (req, res) => {
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    const auth = pusher.authenticate(socketId, channel);
    res.send(auth);
});

app.post("/calculate-trip-additions", async (req, res) => {
    const start_date = req.body.start_date;
    const end_date = req.body.end_date;
    const user_id = req.body.user_id;
    // const company_id = req.body.company_id;
    // const service = req.body.service;

    var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and gpx_time >= '"+start_date+"' and gpx_time <= '"+end_date+"' and accuracy <= 300 ORDER BY gpx_time ASC ALLOW FILTERING;";
    var query2 = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and where gpx_time >= '"+start_date+"' and where gpx_time <= '"+end_date+"' ORDER BY gpx_time ASC ALLOW FILTERING;";
    
    let xx = await getFromDB(query);



    let formated_start_date = new Date(start_date);
    let formated_end_date = new Date(end_date);
    let results = xx.rows.filter(element => {
        // console.log(element.user_id );
        return (element.user_id == user_id && element.gpx_time >= formated_start_date && element.gpx_time <= formated_end_date);
    });
    results = array_values(results);

    let sanitized_points = [];
    if (results.length > 0) {
        setGpx(results);
        sanitized_points = sanitize();
    }
    line_string_container = {
        "type" : "LineString",
        "coordinates" : [],
    };

    let total_sanitized_points = sanitized_points.length;
    if (total_sanitized_points == 1){
        line_string_container.coordinates = [
            [sanitized_points[0].longitude,sanitized_points[0].latitude],
            [sanitized_points[0].longitude,sanitized_points[0].latitude],
        ];
    }else{
        for (let index = 0; index < sanitized_points.length; index++) {
            line_string_container.coordinates.push([sanitized_points[index].longitude,sanitized_points[index].latitude]);
        }
    }
    let distance = geojsonLength(line_string_container);

    res.send(JSON.stringify({line_string_geo_json:line_string_container,distance:distance}));

});


function array_values(array) {
    return array.filter(Boolean);
}

function getFromDB(query) {
    return new Promise(function (resolve) {
        models.instance.Gpx.execute_query(query, {}, function(err, Gpxs){
            resolve(Gpxs);
        });
    });
}






const server = app.listen(3000, () => {
    console.log('Connected to port ' + 3000)
})
// 404 Error
app.use((req, res, next) => {
    next(createError(404));
});
app.use(function (err, req, res, next) {
    console.error(err.message);
    if (!err.statusCode) err.statusCode = 500;
        res.status(err.statusCode).send(err.message);
});
