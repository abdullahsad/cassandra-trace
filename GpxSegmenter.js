let gpx = [];
const setGpx = (gpx) => {
    this.gpx = gpx;
}


function segmentByTimeAndDistance() {
    let previous_latitude = this.gpx[0].latitude;
    let previous_longitude = this.gpx[0].longitude;
    // let previous_time = Carbon::createFromFormat('Y-m-d H:i:s.u', $this->points[0]['gpx_time']);
    let previous_time = new Date(this.gpx[0].gpx_time)
    let segments = [];
    let segments_container = [];
    for (let index = 0; index < this.gpx.length; index++) {
        let current_time = new Date(this.gpx[index].gpx_time);
        let current_latitude = this.gpx[index].latitude;
        let current_longitude = this.gpx[index].longitude;
        let time_difference = parseInt(((current_time - previous_time) / 1000) / 60);
        let distance = getDistance(previous_latitude,previous_longitude, current_latitude,current_longitude,'M');
        if (time_difference > 10 || distance > 100) {
            if (segments.length > 0) {
                if (segments.length == 1) {
                    segments.push(segments[0]);
                }
                segments_container.push(segments);
                segments = [];
            }
        }else{
            segments.push(this.gpx[index]);
        }
        previous_longitude = current_longitude;
        previous_latitude = current_latitude;
        previous_time = new Date(this.gpx[index].gpx_time);
    }
    if (segments.length > 0) {
        if (segments.length == 1) {
            segments.push(segments[0]);
        }
        segments_container.push(segments);
    }
    return segments_container;
}


function getDistance(lat1, lon1, lat2, lon2, unit){
    let theta = lon1 - lon2;
    let dist = Math.sin(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) +  Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.cos(deg2rad(theta));
    dist = Math.acos(dist);
    dist = rad2deg(dist);
    miles = dist * 60 * 1.1515;
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