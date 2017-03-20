var express = require('express');
var router = express.Router();
var firebase = require('firebase');
var request = require('request');
var Promise = require('promise');

var google_places_key = 'AIzaSyAtTEX9hZNXpY5ySqbgMGMeV4glD6zWYFs';
var zip_api_key = 'OKps6n5Q5fbeD9nqEdWqYGSryy1bWhfL2Ed82jZ8yambjKCXYyoWegoNOpZLHfxJ';

var activities = {
    adventure: ['campground'],
    athletic: ['park', 'stadium'],
    casual: ['shopping_mall', 'restaurant', 'book_store', 'cafe', 'library', 'park'],
    amusement: ['amusement_park', 'bowling_alley', 'zoo'],
    entertainment: ['art_gallery', 'aquarium', 'museum', 'movie_theater'],
    foodie: ['bakery', 'cafe', 'restaurant'],
    retreat: ['spa'],
    traveler: ['point_of_interest'],
    nightlife: ['bar', 'casino', 'night_club']
};

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('index', { title: 'Hwoosh' });
});

/* GET users. */
router.get('/users', function(req, res, next) {
    var database = firebase.database();
    var ref = database.ref('/users');

    ref.once('value').then(function(snapshot) {
        res.json(snapshot.val());
    });
});

/* GET places. */
router.get('/places/:user_id/:query', function(req, res, next) {
    var user_id = req.params.user_id;
    var query = req.params.query;

    getUser(user_id)
        .then(function(user) {
            performSearch(user, query)
                .then(function(payload) {
                    res.json({ payload: payload });
                })
                .catch(function(error) {
                    res.json(error);
                });
        });

    function performSearch(user, query) {
        var promises = [];
        for (var i=0; i<activities[user.tag].length; i++) {
            promises.push(getPlacesOfType(activities[user.tag][i], query));
        }

        return new Promise(function(resolve, reject) {
            Promise.all(promises)
                .then(function(results) {
                    var placesPayload = [].concat.apply([], results);
                    resolve(placesPayload);
                })
                .catch(function(error) {
                    reject(error);
                });
            })
        }
});

/* Confirm zipcode */
router.get('/zip/:zip_code', function(req, res, next) {
    var zip_code = req.params.zip_code;
    var url = 'https://www.zipcodeapi.com/rest/' +
            zip_api_key + '/info.json/' + zip_code + '/degrees';
    request(url, function (error, response, payload) {
        if (!error && response.statusCode == 200) {
            res.json(JSON.parse(payload));
        } else {
            res.json({error_code: 400, error_msg: "Invalid request."});
        }
    });
})

module.exports = router;

function parsePlaces(payload)
{
    var places = [];
    for (var i=0;i<payload.results.length;i++) {
        var place = {
            icon: payload.results[i].icon,
            name: payload.results[i].name,
            rating: payload.results[i].rating,
            types: payload.results[i].types,
            address: payload.results[i].vicinity
        };
        places.push(place);
    }
    return places;
}

function getPlacesOfType(type, query)
{
    var latitude = '33.7104';
    var longitude = '-117.9513';
    var minprice = '0';
    var maxprice = '4';

    var url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?' + 
                'key=' + google_places_key + 
                '&location=' + latitude + ',' + longitude +
                '&radius=10000' + 
                '&rankby=prominence' + 
                '&type=' + type +
                '&keyword=' + query;

    return new Promise(function(resolve, reject) {
        request(url, function (error, response, payload) {
        if (!error && response.statusCode == 200) {
            console.log(payload);
            placesData = parsePlaces(JSON.parse(payload));
            resolve(placesData);
        } else {
            reject(error);
        }
    })
    });
}

function getUser(user_id)
{
    var ref = firebase.database().ref().child("users/"+user_id);
    return new Promise(function(resolve, reject) {
        ref.once("value", function(snapshot){
            var user = {
                tag: snapshot.val().Toptag,
                latlong: snapshot.val().Latitude + ',' + snapshot.val().Longitude,
                budget: snapshot.val().Budget
            };
            resolve(user);
            // getLatLong(snapshot.val().Zipcode)
            //     .then(function(payload) { 
            //         console.log(payload);
            //         latlong = payload;
            //         var user = {
            //             tag: snapshot.val().Toptag,
            //             latlong: latlong,
            //             budget: snapshot.val().Budget
            //         };
            //         console.log(user);
            //         resolve(user);
            // });
        });
    })
}

function getLatLong(zip_code)
{
    var url = 'https://www.zipcodeapi.com/rest/' +
            zip_api_key + '/info.json/' + zip_code + '/degrees';

    return new Promise (function (resolve, reject) {
        request(url, function (error, response, payload) {
            if (!error && response.statusCode == 200) {
                var jsonObject = JSON.parse(payload);
                resolve(jsonObject.lat + ',' + jsonObject.lng);
            } else {
               reject({});
            }
        });
    })
}