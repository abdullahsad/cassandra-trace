
let gpx = [];
let init_gpx = null;
const setGpx = (gpx) => {
    this.init_gpx = gpx[0];
    gpx.splice(0, 1);
    this.gpx = gpx;
}


const sanitize =  () => {
    let first_gpx = this.init_gpx;
    let last_gpx = null;
    let sanitized_data = [];
    let temp_point = [];
    sanitized_data.push(this.init_gpx);
    for (let i = 0; i < this.gpx.length; i++) {
        if (getDistance(first_gpx,this.gpx[i], 'M') < 50) {
            last_gpx = this.gpx[i];
            temp_point.push(this.gpx[i]);
        }else {
            if (last_gpx != null) {
                if (parseInt((new Date(last_gpx.gpx_time) - new Date(first_gpx.gpx_time)) / 1000) > 20) {
                    let centroid = GetCenterFromDegrees(temp_point);
                    sanitized_data.push(centroid);
                }

                
            }
            sanitized_data.push(this.gpx[i]);
            first_gpx = this.gpx[i];
            last_gpx = null
            temp_point = [];
        }
    }
    if (temp_point.length > 0) {
        sanitized_data.push(GetCenterFromDegrees(temp_point));
    }
    return sanitized_data;
}

function getDistance(source,destination,unit = 'M')
{
    let theta = source.longitude - destination.longitude;
    let dist = Math.sin(deg2rad(source.latitude)) * Math.sin(deg2rad(destination.latitude))
        +  Math.cos(deg2rad(source.latitude)) * Math.cos(deg2rad(destination.latitude)) * Math.cos(deg2rad(theta));
    dist = Math.acos(dist);
    dist = rad2deg(dist);
    let miles = dist * 60 * 1.1515;
    unit = unit.toUpperCase();

    if (unit == "K") {
        return (miles * 1.609344);
    } else if (unit == "M") {
        return (miles * 1609.344);
    } else {
        return miles;
    }
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

function GetCenterFromDegrees(points)
{

    let num_coords = points.length;

    let X = 0.0;
    let Y = 0.0;
    let Z = 0.0;
    for (let i = 0; i < num_coords; i++){
        let lat = deg2rad(points[i].latitude);
        let lon = deg2rad(points[i].longitude);

        X += Math.cos(lat) * Math.cos(lon);
        Y += Math.cos(lat) * Math.sin(lon);
        Z += Math.sin(lat);
    }

    X /= num_coords;
    Y /= num_coords;
    Z /= num_coords;
    lon = Math.atan2(Y, X);
    hyp = Math.sqrt(X * X + Y * Y);
    lat = Math.atan2(Z, hyp);

    return {
        latitude: rad2deg(lat),
        longitude: rad2deg(lon),
        created_at:points[0].created_at,
        gpx_time:points[0].gpx_time,
        speed:points[0].speed,
        user_id:points[0].user_id
    }
}

module.exports =  {
    setGpx,
    sanitize
};

