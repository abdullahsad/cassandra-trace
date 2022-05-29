module.exports = {
    fields:{
        id : {
            type: "uuid",
            default: {"$db_function": "uuid()"}
        },
        user_id: "int",
        longitude: "double",
        latitude: "double",
        speed: "double",
        bearing: "double",
        created_at: "timestamp",
        updated_at: "timestamp",
        altitude: "double",
        gpx_time: "timestamp",
        is_offline_data: "tinyint",
        accuracy: "double",
        company_id: "int",
        service: "text"
    },
    key:["user_id","gpx_time","service","company_id",'id'],
}





