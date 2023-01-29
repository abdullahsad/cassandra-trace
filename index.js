var express = require('express');
const Pusher = require("pusher");
var jwt = require('jsonwebtoken');
var axios = require('axios').default;
const bodyParser = require("body-parser");
const cors = require("cors");
var dayjs = require('dayjs')
var multer = require('multer');
var morgan = require('morgan');
var fs = require('fs');
var logFile = 'output.log';
var forms = multer();
// const Tile38 = require('tile38');
const { Server } = require("socket.io");
var app = express();
app.use(cors());
app.use(
    morgan('combined', {
      stream: logFile
        ? fs.createWriteStream(logFile, { flags: 'a' })
        : process.stdout,
    }),
);
app.use(bodyParser.json());
app.use(forms.array()); 
app.use(bodyParser.urlencoded({ extended: true }));
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
            keyspace: 'test_5',
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



app.get('/test', function(req, res) {
    // const client = new Tile38();
    // client.set('fleet', 'truck2', [33.5211, -112.2710]).then(() => {
    //     console.log("done");
    // }).catch(err => {
    //     console.error(err);
    // });
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

    // models.instance.Gpx.execute_query(query, {}, function(err, Gpxs){
    //     resolve(Gpxs);
    // });
    try {
        var decoded = jwt.verify('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC9sb2NhbGhvc3Q6ODAwMFwvYXBpXC92MVwvbG9naW4iLCJpYXQiOjE2NTQwODcxNjAsImV4cCI6MTY1NTM4MzE2MCwibmJmIjoxNjU0MDg3MTYwLCJqdGkiOiJZOUU0NzE2ekRHZ1JOZG5oIiwic3ViIjoxLCJwcnYiOiIyM2JkNWM4OTQ5ZjYwMGFkYjM5ZTcwMWM0MDA4NzJkYjdhNTk3NmY3In0.EmnipTkfEpGzwOe0xua-C77o5TepGrkjk5q2PQLwMC0', 'X3omvHLclBjAD7kID74XsN1W9JjMFZSbBbnm8qWrEgCM9zfLiFSZof3m9aEe43Om');
        if (decoded) {
            res.send('decoded');
        }
    } catch(err) {
        res.status(500).json({error: err.message});
    }
    //   pusher.trigger("private-c1", "e1", {
    //     message: "hello world",
    //   });
    //   res.send('gpx added!');

});

app.post('/gpx-bulk-insert', function(req, res) {
    var queries = [];
    var data = JSON.parse(req.body.gpx_bulk);
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
            company_id:parseInt (data[i].company_id),
            service:data[i].service
        });
        var save_query = tmp_gpx.save({return_query: true});
        queries.push(save_query);
    }
    models.doBatch(queries, function(err,res){
        if(err) throw err;
    });
    res.send('offline gpx added!');

});

app.post('/add-gpx', function(req, res) {
   
    const { user_id, longitude, latitude , speed , bearing , altitude , gpx_time , is_offline_data , accuracy , company_id , service } = req.body;

    // if (!(user_id && longitude && latitude && speed && bearing && altitude && gpx_time && is_offline_data && accuracy && company_id && service)) {
    //     res.status(400).send("All input is required");
    // }
    //check if any value is null or empty


    if (user_id == null || longitude == null || latitude == null || speed == null || bearing == null || altitude == null || gpx_time == null || is_offline_data == null || accuracy == null || company_id == null || service == null || user_id == '' || longitude == '' || latitude == '' || speed == '' || bearing == '' || altitude == '' || gpx_time == '' || is_offline_data == '' || accuracy == '' || company_id == '' || service == '') {
        res.send("All input is required");
    }else{
        var gpx = new models.instance.Gpx({
            user_id: parseInt(user_id),
            longitude:parseFloat( longitude),
            latitude:parseFloat( latitude),
            speed:parseFloat( speed),
            bearing:parseFloat( bearing),
            created_at: Date.now(),
            updated_at: Date.now(),
            altitude: parseFloat(altitude),
            gpx_time: new Date(gpx_time),
            is_offline_data: 0,
            accuracy: parseFloat(accuracy),
            company_id:parseInt (company_id),
            service: service
        });
        gpx.save(function(err){
            if(err) {
                console.log(err);
                res.send(err);
            }else{
                pusher.trigger("user-gpx", "gpx-"+gpx.service+"-company-"+gpx.company_id, {
                    message: gpx,
                });
        
                res.send(gpx);  
            }
            // const client = new Tile38();
            // client.set(service+'_company_'+company_id+'_gpx', service+'_company_'+company_id+'_user_'+user_id, [latitude, longitude]).then(() => {
            //     console.log("done");
            // }).catch(err => {
            //     console.error(err);
            // });
    
             
        });
    }

    


});

app.post('/get-user-last-gpx', function(req, res) {

    const { user_id, company_id, service } = req.body;

    if (!(user_id && company_id && service)) {
        res.status(400).send("All input is required");
    }else{
        var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and company_id ="+company_id+" and service='"+service+"' ORDER BY gpx_time DESC LIMIT 1 ALLOW FILTERING;";
        models.instance.Gpx.execute_query(query, {}, function(err, data){
            res.send(data);
        });
    }

});

app.post('/get-user-status', function(req, res) {

    const { user_id } = req.body;

    if (!(user_id)) {
        res.status(400).send("All input is required");
    }else{
        var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and company_id =1 and service='TMS' ORDER BY gpx_time DESC LIMIT 1 ALLOW FILTERING;";
        models.instance.Gpx.execute_query(query, {}, function(err, data){
            if(data.rowLength == 0){
                res.send({'status':'OFFLINE'});
            }
            else{
                var currentdate = new Date(); 
                var ms = Math.abs(currentdate - data.rows[0].gpx_time);
                var diff = ms / 1000;
                if(diff > 300){
                    res.send({'status':'OFFLINE'});
                }else{
                    res.send({'status':'ONLINE'});
                }
            }
        });
    }

});

app.post('/get-users-last-gpx-with-status', function(req, res) {

    const { users_id, company_id, service } = req.body;

    if (!(users_id && company_id && service)) {
        res.status(400).send("All input is required");
    }else{
        var users_array = users_id.split(',');
        var all_user_Data = [];
        var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id IN ("+users_id+") and company_id ="+company_id+" and service='"+service+"' GROUP BY user_id ORDER BY gpx_time DESC ALLOW FILTERING;";
        // var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and company_id ="+company_id+" and service='"+service+"' ORDER BY gpx_time DESC LIMIT 1 ALLOW FILTERING;";
        models.instance.Gpx.execute_query(query, {}, function(err, data){
            // res.send(data.rows);
            var currentdate = new Date(); 
            var a = new Date('2018-01-17T21:18:00');
            var ab= new Date('2018-01-17T21:18:00');
            var ms = Math.abs(ab - a);
            var min = Math.floor((ms/1000/60) << 0);
            console.log(min) // safe to use
            for(var i=0;i<users_array.length;i++){
                var result = data.rows.filter(row => row.user_id == users_array[i]);
                if(result.length > 0){
                    all_user_Data.push(
                        {
                            user_id: result[0].user_id,
                            latitude: result[0].latitude,
                            longitude: result[0].longitude,
                            gpx_time: result[0].gpx_time,
                            speed: result[0].speed,
                        }
                    );
                }
            }
            res.send(all_user_Data);
        });
    }

});

app.post('/get-company-user-last-gpx', async function(req, res) {

    const { company_id, service } = req.body;

    if (!(company_id && service)) {
        res.status(400).send("All input is required");
    }else{
        // var q1 = "SELECT DISTINCT user_id FROM gpx;"
        // models.instance.Gpx.execute_query(q1, {}, function(err, data){
        //     var users_array = data.rows;
        //     // res.send(users_array);
        //     var result = users_array.map(function(a) {return a.user_id;});
        //     var all_user_Data = [];
        //     var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id IN ("+result+") and company_id ="+company_id+" and service='"+service+"' GROUP BY user_id ORDER BY gpx_time DESC ALLOW FILTERING;";
        //     models.instance.Gpx.execute_query(query, {}, function(err, data){
        //         for(var i=0;i<result.length;i++){
        //             var result2 = data.rows.filter(row => row.user_id == result[i]);
        //             if(result2.length > 0){
        //                 all_user_Data.push(
        //                     {
        //                         user_id: result2[0].user_id,
        //                         latitude: result2[0].latitude,
        //                         longitude: result2[0].longitude,
        //                         gpx_time: result2[0].gpx_time,
        //                         speed: result2[0].speed,
        //                     }
        //                 );
        //             }
        //         }
        //         res.send(all_user_Data);
        //     });
        // });
        if(service == 'HR_TRACE'){
            var all_user = await getHrTraceUserByCompany(company_id);
            // res.send(all_user.users[0]);
            all_user_Data = [];
            for(var i=0;i<all_user.users.length;i++){
                var user_id = all_user.users[i].id;
                var q1 = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and company_id ="+company_id+" and service='"+service+"' ORDER BY gpx_time DESC LIMIT 1 ALLOW FILTERING;";
                let xx = await getFromDB(q1);
                var gpx_data = xx.rows;
                if (gpx_data.length > 0) {
                    all_user_Data.push(
                        {
                            user_id: gpx_data[0].user_id,
                            latitude: gpx_data[0].latitude,
                            longitude: gpx_data[0].longitude,
                            gpx_time: gpx_data[0].gpx_time,
                            speed: gpx_data[0].speed,
                        }
                    );
                }
            }
            res.send(all_user_Data);
        }else{
            var all_user_Data = [];
            res.send(all_user_Data);
        }

    }

});

app.post('/get-hr-trace-user-statistics', async (req, res) => {

    const { user_id,api_key,name,start_date,end_date } = req.body;

    if (!(user_id && start_date && end_date && api_key && name)) {
        res.status(400).send("All input is required");
    }else{
        var q1 = "SELECT latitude,longitude,gpx_time FROM gpx WHERE service = 'HR_TRACE' and user_id = "+user_id+" and gpx_time >= '"+start_date+" 00:00:00' and gpx_time <= '"+end_date+" 23:59:59' ORDER BY gpx_time ASC ALLOW FILTERING;"
        var ret_data = [];
        let xx = await getFromDB(q1);
        var gpx_data = xx.rows;
        var attendance_data = [];
        if (gpx_data.length > 0) {
            attendance_data = await getHrTraceAttendanceData(user_id, start_date, end_date);
            attendance_data = attendance_data.attendence;
        }else{
            return res.send(attendance_data);
        }
        for (let index = 0; index < attendance_data.length; index++) {
            var this_day_checkin_time = '';
            var this_day_checkout_time = '';
            if (!(typeof(attendance_data[index].enter_time) === 'undefined') && !(attendance_data[index].enter_time === null)) {
                this_day_checkin_time = attendance_data[index].enter_time;
            }else{
                continue;
            }
            if (!(typeof(attendance_data[index].exit_time) === 'undefined') && !(attendance_data[index].exit_time === null)) {
                this_day_checkout_time = attendance_data[index].exit_time;
            }else{
                this_day_checkout_time = new Date(attendance_data[index].enter_time);
                this_day_checkout_time.setHours(23);
            }

            var this_day_data = gpx_data.filter(row => Date.parse(row.gpx_time) >= Date.parse(this_day_checkin_time) && Date.parse(row.gpx_time) <= Date.parse(this_day_checkout_time));
            if (this_day_data.length > 0) {
                ret_data = ret_data.concat(await populateStatisticsRowForHrTrace(this_day_checkin_time,this_day_data,name,attendance_data[index],api_key));
            }
        }

        res.send(ret_data);
    }

});


async function populateStatisticsRowForHrTrace(checkin_time,gpx_data,name,attendance_data,api_key) {
    var ret_data = [];
    var today = new Date(checkin_time);
    ret_data.push({
        Date:dayjs(today).format('DD/MM/YYYY'),
        Nane:name,
        Time: dayjs(today).format('hh:mm A'),
        Address: attendance_data.checkin_address,
        Distance: "0 km",
        "Location Service" : "On",
    });
    today.setHours(today.getHours() + 1);
    var first_data = gpx_data[0];
    for (let index = 0; index < 24; index++) {
        var this_hour_data = gpx_data.filter(row => row.gpx_time <= today);
        if (this_hour_data.length == 0) {
            today.setHours(today.getHours() + 1);
            continue;
        }
        var last_data = this_hour_data[this_hour_data.length - 1];
        var address  = '';
        address = await getRevGeoAddress(last_data.latitude,last_data.longitude,api_key);
        if ((typeof(address.place.address) === 'undefined') && (address.place.address === null)) {
            var att_address = address.place.area + " ," + address.place.city + " ," + address.place.sub_district + " ," + address.place.district;
        }else{
            var att_address = address.place.address + " ," + address.place.sub_district + " ," + address.place.district;
        }
        var distance = getDistanceFromLatLonInKm(first_data.latitude,first_data.longitude,last_data.latitude,last_data.longitude);
        ret_data.push({
            Date:dayjs(today).format('DD/MM/YYYY'),
            Nane:name,
            Time: dayjs(today).format('hh:mm A'),
            Address: att_address,
            Distance: distance + " km",
            "Location Service" : (last_data.is_offline_data == 1) ? "Off" : "On",
        });
        first_data = last_data;
        today.setHours(today.getHours() + 1);
        if (today > gpx_data[gpx_data.length - 1].gpx_time) {
            break;
        }
    }
    return ret_data;
}


function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2-lat1);  // deg2rad below
    var dLon = deg2rad(lon2-lon1);
    var a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = R * c; // Distance in km
    return (Math.round(d * 100) / 100).toFixed(2);
}

function deg2rad(deg) {
    return deg * (Math.PI/180)
}




app.post("/pusher/auth", (req, res) => {
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;




    const auth = pusher.authenticate(socketId, channel);
    console.log('auth',auth);
    console.log('socketId',socketId);
    console.log('channel',channel);
    res.send(auth);

});

app.post("/calculate-trip-additions", async (req, res) => {
    const start_date = req.body.start_date;
    const end_date = req.body.end_date;
    const user_id = req.body.user_id;
    const company_id = req.body.company_id;
    const service = req.body.service;

    var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and gpx_time >= '"+start_date+"' and gpx_time <= '"+end_date+"' and company_id ="+company_id+" and service='"+service+"' and accuracy <= 300 ORDER BY gpx_time ASC ALLOW FILTERING;";
    var query2 = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and where gpx_time >= '"+start_date+"' and where gpx_time <= '"+end_date+"' ORDER BY gpx_time ASC ALLOW FILTERING;";
    // models.instance.Gpx.execute_query(query, {}, function(err, Gpxs){
    //     resolve(Gpxs);
    // });
    // res.send(query);
    // models.instance.Gpx.execute_query(query, {}, function(err, Conversations){
    //         res.send(JSON.stringify(Conversations));
    //         res.send(err);
    // });
    let xx = await getFromDB(query);

    // res.send(xx);

    let formated_start_date = new Date(start_date);
    let formated_end_date = new Date(end_date);
    let results = xx.rows.filter(element => {
        // console.log(element.user_id );
        return (element.user_id == user_id && element.gpx_time >= formated_start_date && element.gpx_time <= formated_end_date);
    });
    results = array_values(results);
    // res.send(results);
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

    res.send({line_string_geo_json:line_string_container,distance:distance});

});

// app.post("/get-stall-points", async (req, res) => {
//     const start_date = req.body.start_date;
//     const end_date = req.body.end_date;
//     const user_id = req.body.user_id;
//     const company_id = req.body.company_id;
//     const service = req.body.service;

//     var query = "SELECT user_id,latitude,longitude,gpx_time,speed,created_at FROM gpx where user_id = "+user_id+" and gpx_time >= '"+start_date+"' and gpx_time <= '"+end_date+"' and company_id ="+company_id+" and service='"+service+"' and accuracy <= 300 ORDER BY gpx_time ASC ALLOW FILTERING;";


//     let xx = await getFromDB(query);

//     // res.send(xx);

//     let formated_start_date = new Date(start_date);
//     let formated_end_date = new Date(end_date);
//     let results = xx.rows.filter(element => {
//         // console.log(element.user_id );
//         return (element.user_id == user_id && element.gpx_time >= formated_start_date && element.gpx_time <= formated_end_date);
//     });
//     results = array_values(results);
//     // res.send(results);
//     var stall_points = [];
//     var prev_gpx = results[0];
//     for(var i = 0; i < results.length; i++)
//     {
//         if (
//             ((results[i]['speed'] * 3.6) <= 1)
//             && ((Carbon::parse(results[i]['gpx_time'])->diffInMinutes(Carbon::parse(prev_gpx['gpx_time'])) < 5))
//         ){
//             array_push(stall_points,results[i]);
//         }
//         // $prev_gpx = results[i];
//         prev_gpx = results[i];
//     }
//     //         return $stall_points;

//     res.send({line_string_geo_json:line_string_container,distance:distance});

// });

// public function segmentByStallPoints(array $definition = ['time' => 5, 'speed' => 1])
//     {
//         $points = GPX::where('user_id',3035)->orderBy('gpx_time', 'asc')->get()->toArray();

//         $stall_points = [];
//         $prev_gpx = $points[0];
//         foreach ($points as $point)
//         {
//             if (
//                 (($point['speed'] * 3.6) <= $definition['speed'])
//                 and ((Carbon::parse($point['gpx_time'])->diffInMinutes(Carbon::parse($prev_gpx['gpx_time'])) < $definition['time']))
//             ){
//                 $stall_points[] = $point;
//             }
//             $prev_gpx = $point;
//         }
//         return $stall_points;
//     }


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

function getRevGeoAddress(lat,lon,api_key){
    return new Promise(function (resolve) {
        var response = axios.get('https://barikoi.xyz/v1/api/search/reverse/'+api_key+'/geocode?longitude='+lon+'&latitude='+lat+'&address=true&district=true&sub_district=true')
        // console.log(response.get)
        // get response data
        .then(response => {
            resolve(response.data);
        })
        // catch and print errors if any
        .catch(error => {
            console.log(error);
        });
    });
}

function getHrTraceAttendanceData(user_id,start_date,end_date){
    return new Promise(function (resolve) {
        var response = axios.get('https://hr.bmapsbd.com/api/get-attendance-for-trace?user_id='+user_id+'&start_date='+start_date+'&end_date='+end_date)
        .then(response => {
            resolve(response.data);
        })
        .catch(error => {
            console.log(error);
        });
    });
}

function getHrTraceUserByCompany(company_id){
    return new Promise(function (resolve) {
        var response = axios.get('https://hr.bmapsbd.com/api/get-user-by-company-id?company_id='+company_id)
        .then(response => {
            resolve(response.data);
        })
        .catch(error => {
            console.log(error);
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

const io = new Server(server);

io.on("connection", (socket) => {
    // send a message to the client
    socket.emit("hello from server", 1, "2", { 3: Buffer.from([4]) });
  
    // receive a message from the client
    socket.on("hello from client", (...args) => {
      console.log(args);
    });
    socket.on("add-gpx", (...args) => {
        const { user_id, longitude, latitude , speed , bearing , altitude , gpx_time , is_offline_data , accuracy , company_id , service } = args[0];
        // console.log(user_id, longitude, latitude , speed , bearing , altitude , gpx_time , is_offline_data , accuracy , company_id , service);
        var gpx = new models.instance.Gpx({
            user_id: parseInt(user_id),
            longitude:parseFloat( longitude),
            latitude:parseFloat( latitude),
            speed:parseFloat( speed),
            bearing:parseFloat( bearing),
            created_at: Date.now(),
            updated_at: Date.now(),
            altitude: parseFloat(altitude),
            gpx_time: new Date(gpx_time),
            is_offline_data: 0,
            accuracy: parseFloat(accuracy),
            company_id:parseInt (company_id),
            service: service
        });
        gpx.save(function(err){
            if(err) {
                console.log(err);
            }
        });
    });
});