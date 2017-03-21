var express = require('express');
var router = express.Router();
var firebase = require('firebase');
var request = require('request');
var bodyParser = require('body-parser');

var Promise = require('promise');

// ************
// Constants
// ************


var google_places_key = 'AIzaSyAUWFmoycJTKUoabKoDo_l6ZiEdn0eGM8k';
var zip_api_key = 'dFLqxcEEbMLLqGSyk1rfWgXmypjCs0xGGj6dvKRHwDtWkmvEoXUkeRHMg0oJ1WpH';

var activities = {
    all: [''],
    adventure: ['campground'],
    athletic: ['park', 'stadium'],
    casual: ['shopping_mall', 'restaurant', 'book_store', 'cafe', 'library', 'park'],
    amusement: ['amusement_park', 'bowling_alley', 'zoo'],
    entertainment: ['art_gallery', 'aquarium', 'museum', 'movie_theater'],
    foodie: ['bakery', 'cafe', 'restaurant', 'food'],
    retreat: ['spa'],
    traveler: ['point_of_interest'],
    nightlife: ['bar', 'casino', 'night_club']
};

var tagsMap = {
    "amusement_park" : "amusement",
    "aquarium" : "entertainment",
    "art_gallery" : "entertainment",
    "bakery" : "foodie",
    "bar" : "nightlife",
    "book_store" : "casual",
    "bowling_alley" : "amusement",
    "cafe" : "foodie",
    "campground" : "adventure",
    "casino" : "nightlife",
    "food" : "foodie",
    "library" : "casual",
    "movie_theater" : "entertainment",
    "museum" : "entertainment",
    "night_club" : "nightlife",
    "park" : "athletic",
    "point_of_interest" : "traveler",
    "restaurant" : "foodie",
    "shopping_mall" : "casual",
    "spa" : "retreat",
    "stadium" : "athletic",
    "zoo" : "amusement"
};

// ************
// Views
// ************

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('index', { title: 'Hwoosh' });
});

// ************
// API
// ************

/* GET users. */
router.get('/users', function(req, res, next) {
    var database = firebase.database();
    var ref = database.ref('/users');

    ref.once('value').then(function(snapshot) {
        res.json(snapshot.val());
    });
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

router.post('/users/tags', function(req, res, next) {
    var types = [];
    types.push(req.body.types);
    var user_id = req.body.user_id;

    if (types === undefined || user_id === undefined) {
        res.json({error_code: 400, error_msg: "Please input valid query and user."});
    }

    for (var i=0; i<types.length;i++) {
        var typesRef = firebase.database().ref().child("types/"+types[i]);
        typesRef.once('value', function(snapshot) {
            var tag = snapshot.val();
            var userRef = firebase.database().ref().child("users/"+user_id+ '/Tags/'+tag);
                userRef.once('value', function(snapshot) {
                    if (snapshot.val() === null) {
                        var tagObject = {
                            name: tag,
                            views: 1
                        };
                        firebase.database().ref('users/'+user_id+'/Tags/'+tag).set(tagObject);
                    } else {
                        snapshot.ref.update({'views': snapshot.val().views + 1})
                    }
                    res.json({status: 200, msg: 'Successfully updated user tags!'});
                });
        });
    }
})

/* GET places. */
router.post('/places', function(req, res, next) {
    var user_id = req.body.user_id;
    var query = req.body.query;
    var latlong = req.body.latlong;

    if (query === undefined || user_id === undefined) {
        res.json({error_code: 400, error_msg: "Please input valid query and user."});
    }

    else {
            getUser(user_id, latlong).then(function(user) {
                performSearch(user_id, user, query, 'all')
                    .then(function(payload) {
                        res.json({ payload: payload });
                    })
                    .catch(function(error) {
                        res.json(error);
                    });
                // performSearch(user, query, user.tag)
                //     .then(function(payload) {
                //         console.log(payload.length);
                //         if (payload.length > 3) {
                //             res.json({ payload: payload });
                //             return
                //         } else {
                //             performSearch(user, query, 'all')
                //                 .then(function(payload) {
                //                     console.log('here' + payload);
                //                     res.json({ payload: payload });
                //                 })
                //                 .catch(function(error) {
                //                     res.json(error);
                //                 });
                //         }
                //     })
                //     .catch(function(error) {
                //         res.json(error);
                //     });
            });
    }
});

router.post('/place', function(req, res, next) {
    var place_id = req.body.place_id;
    var user_id = req.body.user_id;

    if (place_id === undefined || user_id === undefined) {
        res.json({error_code: 400, error_msg: "Please input valid query and user."});
    } else {

        getPlaceDetails(place_id).then(function(payload) {
            res.json({ payload: payload });
            updateUserTags(user_id, payload.types);
        });
    }

});

module.exports = router;

// ************
// Internal Methods
// ************

function performSearch(user_id, user, query, tag) 
{
    var promises = [];
    for (var i=0; i<activities[tag].length; i++) {
        promises.push(getPlacesOfType(activities[tag][i], query, user, user_id));
    }
    return new Promise(function(resolve, reject) {
        Promise.all(promises)
            .then(function(results) {
                var placesPayload = [].concat.apply([], results);
                var sortedByRating = sortByKey(placesPayload, 'rating');
                var sortedByScore = sortByKey(placesPayload, 'score');
                var sortedUnique = removeDuplicates(sortedByScore, "name");
                resolve(sortedUnique.reverse());
            })
            .catch(function(error) {
                reject(error);
            });
        })
}

function getPlacesOfType(type, query, user, user_id)
{
    var latitude = '33.7104';
    var longitude = '-117.9513';
    var minprice = '0';
    var maxprice = '4';

    if (user.budget === 0) {
        maxprice = '2';
    }
    if (user.budget === 1) {
        maxprice = '3';
    }

    var url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?' + 
                'key=' + google_places_key + 
                '&location=' + latitude + ',' + longitude +
                '&radius=10000' + 
                '&rankby=prominence' + 
                '&type=' + type +
                '&query=' + query;

    return new Promise(function(resolve, reject) {
        request(url, function (error, response, payload) {
        if (!error && response.statusCode == 200) {
            parsePlaces(JSON.parse(payload), user_id)
                .then(function(result) {
                    resolve(result);
                });
        } else {
            reject(error);
        }
    })
    });
}


function parsePlaces(payload, user_id)
{
    var tags;
    var score;
    return new Promise(function(resolve, reject) {
        getUserTags(user_id)
        .then(function(result) {
            tags = result;
            var places = [];
            for (var i=0;i<payload.results.length;i++) {
                score = 0;
                for (var j=0; j < payload.results[i].types.length; j++) {
                    if (tagsMap[payload.results[i].types[j]] !== undefined) {
                        var tag = tagsMap[payload.results[i].types[j]];
                        if (tags[tag] !== undefined) {
                            score = score + tags[tag].views;
                        }
                    }
                }

                var place = {
                    icon: payload.results[i].icon,
                    name: payload.results[i].name,
                    rating: payload.results[i].rating !== undefined ? payload.results[i].rating : 1,
                    types: payload.results[i].types,
                    address: payload.results[i].formatted_address,
                    place_id: payload.results[i].place_id,
                    score: score
                };
                places.push(place);
            }
            resolve(places);
        });   
    }); 
}

function getUserTags(user_id)
{
    var ref = firebase.database().ref().child("users/" + user_id + '/Tags');
    return new Promise(function(resolve, reject) {
        ref.once("value", function(snapshot) {
            var tags = snapshot.val();
            if (tags !== undefined) {
                resolve(tags);
            } else {
                reject({error: 400, error_msg: 'Issue with firebase get Top Tag Query'});
            }
        });
    })
}

function getPlaceDetails(place_id)
{
    var url = 'https://maps.googleapis.com/maps/api/place/details/json?' + 
                'key=' + google_places_key +
                '&place_id=' + place_id;

    return new Promise(function(resolve, reject) {
        request(url, function (error, response, payload) {
            if (!error && response.statusCode == 200) {
                placesData = JSON.parse(payload);
                resolve(placesData.result);
            } else {
                reject(error);
            }
        });
    });
}

function getUser(user_id, latlong)
{
    var latLong = latlong;
    var ref = firebase.database().ref().child("users/"+user_id);

    return new Promise(function(resolve, reject) {
        getTag(user_id)
            .then(function(tag) {
                ref.once("value", function(snapshot){
                    var user = {
                        tag: tag,
                        latlong: latLong !== undefined ? latLong : snapshot.val().Latitude + ',' + snapshot.val().Longitude,
                        budget: snapshot.val().Budget
                    };
                    resolve(user);
                });   
            })
            .catch(function(error) {
                reject(error)
            })
    })
}

function getTag(user_id)
{
    var ref = firebase.database().ref().child("users/" + user_id + '/Tags');
    return new Promise(function(resolve, reject) {
        ref.orderByChild('views').limitToLast(1).once("value", function(snapshot) {
            var tag = Object.keys(snapshot.val())[0];
            if (tag !== undefined) {
                resolve(tag);
            } else {
                reject({error: 400, error_msg: 'Issue with firebase get Top Tag Query'});
            }
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

function updateUserTags(user_id, types)
{
    for (var i=0; i<types.length;i++) {
        var typesRef = firebase.database().ref().child("types/"+types[i]);
        typesRef.once('value', function(snapshot) {
            var tag = snapshot.val();
            if (tag !== null) {
                var userRef = firebase.database().ref().child("users/"+user_id+ '/Tags/'+tag);
                    userRef.once('value', function(snapshot) {
                        if (snapshot.val() === null) {
                            var tagObject = {
                                name: tag,
                                views: 1
                            };
                            firebase.database().ref('users/'+user_id+'/Tags/'+tag).set(tagObject);
                        } else {
                            snapshot.ref.update({'views': snapshot.val().views + 1})
                        }
                        return({status: 200, msg: 'Successfully updated user tags!'});
                    });
            }
        });
    }
}

function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = a[key]; var y = b[key];
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

function removeDuplicates(arr, prop) {
     var new_arr = [];
     var lookup  = {};
 
     for (var i in arr) {
         lookup[arr[i][prop]] = arr[i];
     }
 
     for (i in lookup) {
         new_arr.push(lookup[i]);
     }
 
     return new_arr;
 }