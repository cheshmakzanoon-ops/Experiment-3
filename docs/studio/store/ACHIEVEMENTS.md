# MOTOBOUND achievements (54)

Generated from `src/steam/achievements.ts` by `scripts/export-achievements.ts`; do not edit by hand.
The `API name` is the id to create in the Steamworks partner site.

| API name | Name | Description | Category | Hidden | Unlock rule |
| --- | --- | --- | --- | --- | --- |
| `circuit_first_finish` | Flag to Flag | Finish a circuit race in a car. | circuit |  | first matching `race.finished` |
| `circuit_podium` | Rostrum Regular | Finish a circuit car race on the podium. | circuit |  | first matching `race.finished` |
| `circuit_win` | First Chequered | Win a circuit car race. | circuit |  | first matching `race.finished` |
| `circuit_pole_win` | Lights to Flag | Start from pole in a field of at least four and win the circuit race. | circuit |  | first matching `race.finished` |
| `circuit_comeback` | Back of the Grid Hero | Start the circuit race 8th or lower and finish on the podium. | circuit |  | first matching `race.finished` |
| `circuit_endurance` | Long Haul | Finish an endurance race. | circuit |  | first matching `race.finished` |
| `gp_first_finish` | First Lean Angle | Finish a GP motorcycle race. | gp-bike |  | first matching `race.finished` |
| `gp_podium` | Knee Down, Hands Up | Finish a GP motorcycle race on the podium. | gp-bike |  | first matching `race.finished` |
| `gp_win` | Chequered Handlebars | Win a GP motorcycle race. | gp-bike |  | first matching `race.finished` |
| `gp_hat_trick` | Three in a Row | Win three GP motorcycle races in a row. | gp-bike |  | 3 in a row (`race.finished`) |
| `mx_first_finish` | Gate Drop | Finish a motocross moto. | motocross |  | first matching `race.finished` |
| `mx_podium` | Mud on the Podium | Finish a motocross moto on the podium. | motocross |  | first matching `race.finished` |
| `mx_win` | King of the Hill | Win a motocross moto. | motocross |  | first matching `race.finished` |
| `sx_first_finish` | Under the Floodlights | Finish a supercross race. | supercross |  | first matching `race.finished` |
| `sx_win` | Rhythm Section | Win a supercross race. | supercross |  | first matching `race.finished` |
| `dirt_double` | Dirt Double | Finish both a motocross moto and a supercross race. | supercross |  | 2 distinct `discipline` (`race.finished`) |
| `festival_first` | Off the Map | Complete an open-world festival event. | festival |  | first matching `festival.activity` |
| `festival_stars` | Three-Star Day | Earn three stars in a festival event. | festival |  | first matching `festival.activity` |
| `festival_race_win` | Street Legal Winner | Win a festival race against rivals. | festival |  | first matching `festival.activity` |
| `festival_drifter` | Sideways Savant | Score 7,000 points in a drift zone. | festival |  | first matching `festival.activity` |
| `festival_radar` | Radar Magnet | Break 250 km/h through a speed trap. | festival |  | first matching `festival.activity` |
| `festival_wanderer` | Wanderer | Discover 8 places in the festival world. | discovery |  | first matching `festival.discovered` |
| `festival_cartographer` | Cartographer | Discover 16 places in the festival world. | discovery |  | first matching `festival.discovered` |
| `festival_air` | Hang Time | Land a jump after a full second in the air. | festival |  | first matching `festival.jump` |
| `festival_big_air` | Long Way Down | Land a jump after two seconds in the air. | festival | yes | first matching `festival.jump` |
| `festival_flow` | Flow State | Bank a skill chain worth 1,500 points. | festival |  | first matching `festival.chain` |
| `festival_unbroken` | Unbroken | Bank a skill chain worth 5,000 points. | festival |  | first matching `festival.chain` |
| `festival_needle` | Needle Thread | Make 25 clean passes of ambient traffic. | festival |  | 25 x `festival.cleanPass` |
| `weather_wet_finish` | Wet Wheels | Finish a race while it is raining. | weather |  | first matching `race.finished` |
| `weather_wet_win` | Rain Maker | Win a race while it is raining. | weather |  | first matching `race.finished` |
| `weather_three` | Three Skies | Finish races in three different weather conditions. | weather |  | 3 distinct `weather` (`race.finished`) |
| `weather_all` | Whole Forecast | Finish races in six different weather conditions. | weather |  | 6 distinct `weather` (`race.finished`) |
| `clean_race` | Spotless | Finish a race with no penalties and no damage. | clean |  | first matching `race.finished` |
| `clean_win` | Not a Mark on It | Win a race with no penalties and no damage. | clean |  | first matching `race.finished` |
| `clean_streak` | Hands Off the Paint | Finish five races in a row without a penalty or damage. | clean |  | 5 in a row (`race.finished`) |
| `venue_five` | Passport Stamp | Finish races at five different venues. | discovery |  | 5 distinct `circuitId` (`race.finished`) |
| `venue_fifteen` | Grand Tour | Finish races at fifteen different venues. | discovery |  | 15 distinct `circuitId` (`race.finished`) |
| `vehicle_five` | Test Pilot | Finish races in five different vehicles. | discovery |  | 5 distinct `vehicleId` (`race.finished`) |
| `vehicle_fifteen` | Whole Garage | Finish races in fifteen different vehicles. | discovery |  | 15 distinct `vehicleId` (`race.finished`) |
| `lap_record_first` | Faster Than Before | Set a personal-best lap time. | discovery |  | first matching `lap.record` |
| `lap_record_ten` | Chasing Hundredths | Set ten personal-best lap times. | discovery |  | 10 x `lap.record` |
| `photo_first` | Shutter Click | Take a photo in photo mode. | discovery |  | first matching `photo.taken` |
| `photo_ten` | Contact Sheet | Take ten photos in photo mode. | discovery |  | 10 x `photo.taken` |
| `wildcard_first` | Wrong Tool, Right Job | Finish a Wildcard race in a vehicle that does not belong at the venue. | wildcard |  | first matching `race.finished` |
| `wildcard_podium` | Odd Couple | Finish a Wildcard race on the podium. | wildcard |  | first matching `race.finished` |
| `wildcard_five` | Misfit Maestro | Finish five Wildcard races on the podium. | wildcard | yes | 5 x `race.finished` |
| `licence_first` | Learner's Badge | Earn any medal in a licence test. | career |  | first matching `career.licence` |
| `licence_gold` | Gold Standard | Earn a gold medal in a licence test. | career |  | first matching `career.licence` |
| `licence_all_gold` | Full Marks | Earn gold in every licence test. | career |  | 5 distinct `licence` (`career.licence`) |
| `season_complete` | Season Done | Complete a championship season. | career |  | first matching `championship.completed` |
| `season_title` | Title Fight Won | Win a championship. | career |  | first matching `championship.completed` |
| `mastery_ten` | Rising Star | Unlock 10 other achievements. | mastery |  | 10 other achievements |
| `mastery_twenty_five` | Seasoned Racer | Unlock 25 other achievements. | mastery |  | 25 other achievements |
| `mastery_all` | Motobound | Unlock every other achievement. | mastery |  | every other other achievements |
