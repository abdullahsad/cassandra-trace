const collect = require("collect.js");


let gpx = [];
let point = {
    'latitude' : null,
    'longitude' : null
};
const setGpx = (gpx) => {
    this.gpx = gpx;
}

function getAnalytics(point_radius_in_metre = 50)
{
    let valid_gpx = [];
    let target_latitude = this.point.latitude;
    let target_longitude = this.point.longitude;
    for (let index = 0; index < this.gpx.length; index++) {
        let point_latitude = this.gpx[index].latitude;
        let point_longitude = this.gpx[index].longitude;
        if (getDistance(point_latitude,point_longitude,target_latitude,target_longitude) < point_radius_in_metre && this.gpx[index].speed <= 0.5){
            valid_gpx.push(this.gpx[index]);
        }   
    }
    valid_gpx = collect(valid_gpx).sortBy('gpx_time');
    if(valid_gpx.length == 1){
        return {
            'in_time' : valid_gpx[0].gpx_time,
            'out_time' : valid_gpx[0].gpx_time,
            'duration' : 0,
        };
    }else if(valid_gpx.length > 1){
        return {
            'in_time' : valid_gpx[0].gpx_time,
            'out_time' : valid_gpx[valid_gpx.length-1].gpx_time,
            'duration' : (new Date(valid_gpx[valid_gpx.length-1].gpx_time) - new Date(valid_gpx[0].gpx_time)) / 1000,
        };
    }
    return {
        'in_time' : null,
        'out_time' : null,
        'duration' : null,
    };

}

function getStDistance(latitude1, longitude1, latitude2, longitude2) {

    let earth_radius = 6371;

    let dLat = deg2rad(latitude2 - latitude1);
    let dLon = deg2rad(longitude2 - longitude1);

    let a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(latitude1)) * Math.cos(deg2rad(latitude2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    let c = 2 * Math.asin(Math.sqrt(a));
    let d = earth_radius * c;

    return d*1000;

}

function deg2rad(degrees)
{
  var pi = Math.PI;
  return degrees * (pi/180);
}

function rad2deg(radians)
{
  var pi = Math.PI;
  return radians * (180/pi);
}