//"use strict";

/**
 * Uranium JS bindings layer
 * du_* - some C/C++ stuff (mostly pointers to objects/structs/arrays)
 */

var m_ipc = b4w.require("__ipc");

var NULL = 0;

var _update_interval = 1/60;
var _do_simulation = true;
var _last_abs_time = 0;

// need cleanup
var _worlds = {};
var _active_world_id = null;

var _vec3_tmp  = new Float32Array(3);
var _vec3_tmp2 = new Float32Array(3);
var _du_vec3_tmp = _du_vec3(0, 0, 0);

function append_world(id) {
    if (!check_world(id)) {
        var du_id = _du_create_world(); 

        var world = {
            du_id: du_id,
            bodies: {},
            constraints: {},
            cars: {},
            boats: {},
            collision_tests: [],
            collision_results: {array: null,
                                size:  0},
            ray_tests: {},
            characters: {},
            floaters: {},
            water: null
        };

        _worlds[id] = world;
        set_active_world(id);
    }
}


function check_world(id) {
    if (id in _worlds)
        return true;
    else
        return false;
}

function set_active_world(id) {
    if (check_world(id)) {
        _du_set_active_world(_worlds[id].du_id);
        _active_world_id = id;
    }
}

/**
 * For internal purposes
 */
function active_world() {
    if (_active_world_id)
        return _worlds[_active_world_id];
    else
        throw "No active world";
}

function get_plus_one(num) {
    return _du_get_plus_one(num);
}

function append_static_mesh_body(id, positions, indices, trans, friction,
        restitution, collision_group, collision_mask) {

    var arrays = create_mesh_arrays(positions, indices);

    var trans_arr = _du_vec3(trans[0], trans[1], trans[2]);
    var du_body = _du_create_static_mesh_body(arrays.indices_len,
            arrays.indices, arrays.positions_len, arrays.positions, trans_arr,
            friction, restitution);

    append_body(id, du_body, false, collision_group, collision_mask);
}

function append_body(id, du_body_id, dynamic, collision_group, collision_mask) {
    var body = {
        du_id: du_body_id,

        simulated: true,
        dynamic: dynamic,
        collision_group: collision_group,
        collision_mask: collision_mask,
        // output cache
        trans: new Float32Array([0,0,0]),
        quat: new Float32Array([0,0,0,1]),
        linvel: new Float32Array([0,0,0]),
        angvel: new Float32Array([0,0,0]),

        // input cache
        du_trans: _du_vec3(0, 0, 0),
        du_quat: _du_quat4(0, 0, 0, 1),
        du_linvel: _du_vec3(0, 0, 0),
        du_angvel: _du_vec3(0, 0, 0),

        applied_central_force: null,

        col_imp_test: false,
        col_imp_test_last_result: -1
    }

    active_world().bodies[id] = body;
    _du_add_body(du_body_id, collision_group, collision_mask);
}

function create_mesh_arrays(positions, indices) {
    var plen = positions.length;
    var pos_arr = _du_alloc_float_array(plen);

    HEAPF32.set(positions, pos_arr >> 2);

    if (indices) {
        var ilen = indices.length;
        var ind_arr = _du_alloc_int_array(ilen);

        HEAP32.set(indices, ind_arr >> 2);

    } else {

        var ilen = positions.length / 3;
        var ind_arr = _du_alloc_int_array(ilen);

        var start = ind_arr >> 2;

        for (var i = 0; i < ilen; i++)
            HEAP32[start + i] = i;
    }

    return {
        indices: ind_arr,
        indices_len: ilen,
        positions: pos_arr,
        positions_len: plen
    }
}

function append_ghost_mesh_body(id, positions, indices, trans,
                                collision_group, collision_mask) {
    var arrays = create_mesh_arrays(positions, indices);

    var trans_arr = _du_vec3(trans[0], trans[1], trans[2]);
    var du_body = _du_create_ghost_mesh_body(arrays.indices_len,
            arrays.indices, arrays.positions_len, arrays.positions, trans_arr);

    append_body(id, du_body, false, collision_group, collision_mask);
}

function append_bounding_body(id, trans, quat, physics_type, is_ghost,
        disable_sleeping, mass, velocity_min, velocity_max, damping,
        rotation_damping, collision_group, collision_mask,
        bounding_type, bounding_object, size,
        friction, restitution, comp_children_params, correct_bound_offset) {

    if (comp_children_params.length) {
        // process compound shape
        var du_shape = _du_create_compound();

        for (var i = 0; i < comp_children_params.length; i++) {
            var child = comp_children_params[i];
            var child_trans = child["trans"];
            var child_quat  = child["quat"];
            var child_bt    = child["bounding_type"];
            var child_wb    = child["worker_bounding"];

            var du_child_trans = _du_vec3(child_trans[0],
                                          child_trans[1], child_trans[2]);

            if (child_quat)
                var du_child_quat = _du_quat4(child_quat[0], child_quat[1],
                                              child_quat[2], child_quat[3]);
            else
                var du_child_quat = NULL;

            var du_child_shape = create_shape(child_bt, child_wb, false);

            _du_compound_add_child(du_shape, du_child_trans, du_child_quat,
                                   du_child_shape);
        }
    } else
        var du_shape = create_shape(bounding_type, bounding_object, correct_bound_offset);

    switch (physics_type) {
    case "STATIC":
        var mass = 0.0;
        var ang_fact_x = 1.0;
        var ang_fact_y = 1.0;
        var ang_fact_z = 1.0;
        break;
    case "DYNAMIC":
        var ang_fact_x = 0.0;
        var ang_fact_y = 0.0;
        var ang_fact_z = 0.0;
        break;
    case "RIGID_BODY":
        var ang_fact_x = 1.0;
        var ang_fact_y = 1.0;
        var ang_fact_z = 1.0;
        break;
    case "NO_COLLISION":
        // NOTE: temporary the same as ghost
        is_ghost = true;
        break;
    default:
        console.error("Unsupported physics type: " + physics_type);
        return null;
    }

    var du_trans = _du_vec3(trans[0], trans[1], trans[2]);

    if (quat)
        var du_quat = _du_quat4(quat[0], quat[1], quat[2], quat[3]);
    else
        var du_quat = NULL;

    if (is_ghost) {
        var du_body = _du_create_ghost_bounding_body(du_shape, du_trans, du_quat);
    } else {
        var du_body = _du_create_dynamic_bounding_body(du_shape, mass,
                du_trans, du_quat, damping, rotation_damping, size, 
                ang_fact_x, ang_fact_y, ang_fact_z, friction, restitution);
    }

    if (disable_sleeping)
        _du_disable_deactivation(du_body);

    if ((physics_type == "RIGID_BODY" || physics_type == "DYNAMIC") && mass && !is_ghost)
        append_body(id, du_body, true, collision_group, collision_mask);
    else
        append_body(id, du_body, false, collision_group, collision_mask);
}

function create_shape(bounding_type, bounding_object, consider_compound) {

    if (bounding_type == "BOX") {
        var bb = bounding_object;

        var ext_x = (bb["max_x"] - bb["min_x"])/2;
        var ext_y = (bb["max_y"] - bb["min_y"])/2;
        var ext_z = (bb["max_z"] - bb["min_z"])/2;

        var cm_x = (bb["max_x"] + bb["min_x"])/2;
        var cm_y = (bb["max_y"] + bb["min_y"])/2;
        var cm_z = (bb["max_z"] + bb["min_z"])/2;

        if (need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z)) {
            cm_x = 0.0;
            cm_y = 0.0;
            cm_z = 0.0;
        }

        var du_shape = _du_create_box_shape(ext_x, ext_y, ext_z, cm_x, cm_y, cm_z);
    } else if (bounding_type == "CYLINDER") {
        var bcyl = bounding_object;

        var ext_x = bcyl["radius"];
        var ext_y = bcyl["height"] / 2;
        var ext_z = bcyl["radius"];

        var cm_x = bcyl["center"][0];
        var cm_y = bcyl["center"][1];
        var cm_z = bcyl["center"][2];

        if (need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z)) {
            cm_x = 0.0;
            cm_y = 0.0;
            cm_z = 0.0;
        }
        var du_shape = _du_create_cylinder_shape(ext_x, ext_y, ext_z, cm_x, cm_y, cm_z);
    } else if (bounding_type == "CONE") {
        var bcon = bounding_object;

        var ext_x = bcon["radius"];
        var ext_y = bcon["height"] / 2;
        var ext_z = bcon["radius"];

        var cm_x = bcon["center"][0];
        var cm_y = bcon["center"][1];
        var cm_z = bcon["center"][2];

        if (need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z)) {
            cm_x = 0.0;
            cm_y = 0.0;
            cm_z = 0.0;
        }

        var du_shape = _du_create_cone_shape(bcon["radius"], bcon["height"], cm_x, cm_y, cm_z);
    } else if (bounding_type == "SPHERE") {
        var bs = bounding_object;

        var ext_x = ext_y = ext_z = bs["radius"];

        var cm_x = bs["center"][0];
        var cm_y = bs["center"][1];
        var cm_z = bs["center"][2];

        if (need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z)) {
            cm_x = 0.0;
            cm_y = 0.0;
            cm_z = 0.0;
        }

        var du_shape = _du_create_sphere_shape(bs["radius"], cm_x, cm_y, cm_z);
    } else if (bounding_type == "CAPSULE") {
        var bcap = bounding_object;

        var ext_x = bcap["radius"];
        var ext_y = bcap["height"] + 2 * bcap["radius"];
        var ext_z = bcap["radius"];

        var cm_x = bcap["center"][0];
        var cm_y = bcap["center"][1];
        var cm_z = bcap["center"][2];

        if (need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z)) {
            cm_x = 0.0;
            cm_y = 0.0;
            cm_z = 0.0;
        }

        var du_shape = _du_create_capsule_shape(bcap["radius"], bcap["height"], cm_x, cm_y, cm_z);
    } else if (bounding_type == "EMPTY") {
        var du_shape = _du_create_empty_shape();
    } else
        throw "Wrong collision bounds type: " + bounding_type;

    return du_shape;
}

function need_center_mass_reset(consider_compound, ext_x, ext_y, ext_z, cm_x, cm_y, cm_z) {
    if (consider_compound == "OFF" ||
          (consider_compound == "AUTO" &&
              (Math.abs(cm_x) < 0.1 * ext_x &&
               Math.abs(cm_y) < 0.1 * ext_y &&
               Math.abs(cm_z) < 0.1 * ext_z))) {
        return true;
    }

    return false;
}

/**
 * Process rigid body joints constraints
 */
function append_constraint(cons_id, pivot_type, limits, body_id_a, trans_in_a, quat_in_a, 
        body_id_b, trans_in_b, quat_in_b, stiffness, damping) {

    var du_body_id_a = get_du_body_id(body_id_a);
    var du_trans_in_a = _du_vec3(trans_in_a[0], trans_in_a[1], trans_in_a[2]);
    var du_quat_in_a = _du_quat4(quat_in_a[0], quat_in_a[1], quat_in_a[2], quat_in_a[3]);

    var du_body_id_b = get_du_body_id(body_id_b);
    var du_trans_in_b = _du_vec3(trans_in_b[0], trans_in_b[1], trans_in_b[2]);
    var du_quat_in_b = _du_quat4(quat_in_b[0], quat_in_b[1], quat_in_b[2], quat_in_b[3]);

    switch(pivot_type) {
    case "GENERIC_6_DOF":
        var du_cons = _du_create_generic_6dof_constraint(du_body_id_a, 
                du_trans_in_a, du_quat_in_a, du_body_id_b, du_trans_in_b, 
                du_quat_in_b);
        break;
    case "GENERIC_6_DOF_SPRING":
        if (stiffness)
            var du_stiffness_arr = _du_array6(stiffness[0], stiffness[1],
                    stiffness[2], stiffness[3], stiffness[4], stiffness[5]);
        else
            // bullet defaults
            var du_stiffness_arr = _du_array6(0,0,0,0,0,0);

        if (damping)
            var du_damping_arr = _du_array6(damping[0], damping[1], damping[2],
                    damping[3], damping[4], damping[5]);
        else
            // bullet defaults
            var du_damping_arr = _du_array6(1,1,1,1,1,1);

        var du_cons = _du_create_generic_6dof_spring_constraint(du_body_id_a, 
                du_trans_in_a, du_quat_in_a, du_body_id_b, du_trans_in_b, 
                du_quat_in_b, du_stiffness_arr, du_damping_arr);
        break;
    case "HINGE":
        // TODO: hinge constraint is now fixed
        limits["use_limit_x"] = true;
        limits["use_limit_y"] = true;
        limits["use_limit_z"] = true;

        limits["use_angular_limit_y"] = true;
        limits["use_angular_limit_z"] = true;

        limits["limit_max_x"] = 0;
        limits["limit_min_x"] = 0;
        limits["limit_max_y"] = 0;
        limits["limit_min_y"] = 0;
        limits["limit_max_z"] = 0;
        limits["limit_min_z"] = 0;

        limits["limit_angle_max_y"] = 0;
        limits["limit_angle_min_y"] = 0;
        limits["limit_angle_max_z"] = 0;
        limits["limit_angle_min_z"] = 0;

        pivot_type = "GENERIC_6_DOF";

        var du_cons = _du_create_generic_6dof_constraint(du_body_id_a, 
                du_trans_in_a, du_quat_in_a, du_body_id_b, du_trans_in_b, 
                du_quat_in_b);

        //var du_cons = new Ammo.btHingeConstraint(body_a, body_b, 
        //        bt_frame_in_a, bt_frame_in_b);
        break;
    case "BALL":
        var du_cons = _du_create_point2point_constraint(du_body_id_a, 
                du_trans_in_a, du_body_id_b, du_trans_in_b);
        break;
    case "CONE_TWIST":
        var du_cons = _du_create_cone_twist_constraint(du_body_id_a, 
                du_trans_in_a, du_quat_in_a, du_body_id_b, du_trans_in_b, 
                du_quat_in_b);
        break;
    default:
        var du_cons = null;
        break
    }

    var disable_linked_collisions = true;

    if (du_cons) {
        set_constraint_limits(du_cons, pivot_type, limits);
        set_constraint_params(du_cons, pivot_type);
        _du_add_constraint(du_cons, disable_linked_collisions);

        active_world().constraints[cons_id] = du_cons;
    }
}

/**
 * Process rigid body joints constraints
 */
function remove_constraint(cons_id) {
    var world = active_world();

    var du_cons = world.constraints[cons_id];
    if (du_cons) {
        _du_remove_constraint(du_cons);
        delete world.constraints[cons_id];
    } else
        throw "Wrong constraint";
}

/**
 * Get C body_id by JS body_id
 */
function get_du_body_id(body_id) {

    var world = active_world();

    var body = world.bodies[body_id];
    if (body)
        return body.du_id;
    else
        throw "Wrong body ID";
}

/**
 * Get JS body_id by C body_id
 */
function get_body_id(du_body_id) {
    var world = active_world();

    for (var body_id in world.bodies) {
        var body = world.bodies[body_id];
        if (body.du_id === du_body_id)
            return body_id;
    }

    return null;
}

function get_world_id(du_world_id) {
    for (var world_id in _worlds) {
        var world = _worlds[world_id];

        if (world.du_id === du_world_id)
            return world_id;
    }

    return null;
}


function set_constraint_limits(du_cons, pivot_type, limits) {

    // NOTE: bullet defaults:
    // no translation limit assigned - corresponding DOF will be fixed
    // no rotation limit assigned - corresponding DOF will remain loose

    switch(pivot_type) {
    case "GENERIC_6_DOF":
    case "GENERIC_6_DOF_SPRING":
        // 0,1,2,3,4,5 -> X,Y,Z,RX,RY,RZ
        var lim_arr = [false, false, false, false, false, false];

        if (limits["use_limit_x"])
            lim_arr[0] = [limits["limit_min_x"], limits["limit_max_x"]];
        if (limits["use_limit_y"])
            lim_arr[1] = [limits["limit_min_y"], limits["limit_max_y"]];
        if (limits["use_limit_z"])
            lim_arr[2] = [limits["limit_min_z"], limits["limit_max_z"]];

        if (limits["use_angular_limit_x"])
            lim_arr[3] = [limits["limit_angle_min_x"], limits["limit_angle_max_x"]];
        if (limits["use_angular_limit_y"])
            lim_arr[4] = [limits["limit_angle_min_y"], limits["limit_angle_max_y"]];
        if (limits["use_angular_limit_z"])
            lim_arr[5] = [limits["limit_angle_min_z"], limits["limit_angle_max_z"]];

        for (var i = 0; i < lim_arr.length; i++) {
            if (lim_arr[i])
                _du_set_generic_6dof_limit(du_cons, i, lim_arr[i][0], lim_arr[i][1]);
            else
                // min > max - loose
                _du_set_generic_6dof_limit(du_cons, i, 1, -1);
        }
        break;
    case "HINGE":
        if (limits["use_angular_limit_x"])
            _du_set_hinge_limit(du_cons, limits["limit_angle_min_x"],
                    limits["limit_angle_max_x"]);
        // else: bullet default behavior
        break;
    case "BALL":
        // no limits
        break;
    case "CONE_TWIST":
        // 3,4,5
        if (limits["use_angular_limit_x"])
            _du_set_cone_twist_limit(du_cons, 3, limits["limit_angle_max_x"]);
        if (limits["use_angular_limit_y"])
            _du_set_cone_twist_limit(du_cons, 4, limits["limit_angle_max_y"]);
        if (limits["use_angular_limit_z"])
            _du_set_cone_twist_limit(du_cons, 5, limits["limit_angle_min_z"]);
        // else: bullet default behavior
        break;
    default:
        throw "Wrong constraint pivot type: " + pivot_type;
        break
    }
}

function set_constraint_params(du_cons, pivot_type) {

    switch(pivot_type) {
    case "GENERIC_6_DOF":
    case "GENERIC_6_DOF_SPRING":
        var axes = [0,1,2,3,4,5];
        break;
    case "HINGE":
        var axes = [-1];
        break;
    case "BALL":
        var axes = [-1];
        break;
    case "CONE_TWIST":
        var axes = [3,4,5];
        break;
    default:
        throw "Wrong constraint pivot type: " + pivot_type;
        break
    }

    for (var i = 0; i < axes.length; i++) {
        var index = axes[i];

        _du_set_constraint_param(du_cons, _du_cons_param_stop_cfm(), 0, index);
        _du_set_constraint_param(du_cons, _du_cons_param_stop_erp(), 0.5, index);
    }
}

function append_car(chassis_body_id, susp_compress, susp_stiffness,
                    susp_damping, wheel_friction, max_suspension_travel_cm) {

    var du_chassis_id = get_du_body_id(chassis_body_id);

    var du_tuning = _du_create_vehicle_tuning(susp_compress, 
                                              susp_stiffness, 
                                              susp_damping, 
                                              wheel_friction,
                                              max_suspension_travel_cm);
    var du_vehicle = _du_create_vehicle(du_chassis_id, du_tuning);

    var car = {
        du_id: du_vehicle,
        du_tuning_id: du_tuning,
        wheels_cache: []
    }

    active_world().cars[chassis_body_id] = car;
    _du_add_action(du_vehicle);
}

function append_boat(hull_body_id, floating_factor, water_lin_damp, water_rot_damp) {

    var du_hull_id = get_du_body_id(hull_body_id);
    var du_boat = _du_create_boat(du_hull_id, floating_factor,
                                  water_lin_damp, water_rot_damp);
    var boat = {
        du_id: du_boat,
        bobs_cache: []
    }

    active_world().boats[hull_body_id] = boat;
    _du_add_action(du_boat);

    // set water if any
    var water = active_world().water;
    if (water) {
        _du_boat_set_water(du_boat, water.du_id);
        for (var i = 0; i < water.dist_arrays.length; i++)
            // if there is dynamic water setup it's wrapper
            if (water.dist_arrays[i])
                _du_boat_set_water_wrapper_ind(du_boat, i);
    }
}

function append_floater(floater_body_id, float_factor,
                        water_lin_damp, water_rot_damp) {

    var du_floater_body_id = get_du_body_id(floater_body_id);
    var du_floater = _du_create_floater(du_floater_body_id, float_factor,
                                        water_lin_damp, water_rot_damp);
    var floater = {
        du_id: du_floater,
        bobs_cache: []
    }

    active_world().floaters[floater_body_id] = floater;
    _du_add_action(du_floater);

    // set water if any
    var water = active_world().water;
    if (water) {
        _du_floater_set_water(du_floater, water.du_id);
        for (var i = 0; i < water.dist_arrays.length; i++)
            // if there is dynamic water setup it's wrapper
            if (water.dist_arrays[i])
                _du_floater_set_water_wrapper_ind(du_floater, i);
    }
}

function get_car(chassis_body_id) {
    var world = active_world();

    var car = world.cars[chassis_body_id];
    if (car)
        return car;
    else
        throw "Wrong car body ID";
}

function get_boat(hull_body_id) {
    var world = active_world();

    var boat = world.boats[hull_body_id];
    if (boat)
        return boat;
    else
        throw "Wrong boat body ID";
}

function get_floater(floater_body_id) {
    var world = active_world();

    var floater = world.floaters[floater_body_id];
    if (floater)
        return floater;
    else
        throw "Wrong floater body ID";
}

function add_car_wheel(chassis_body_id, conn_point, susp_rest_len, 
                       roll_influence, radius, is_front) {

    var car = get_car(chassis_body_id);

    var du_conn_point = _du_vec3(conn_point[0], conn_point[1], conn_point[2]);

    _du_vehicle_add_wheel(car.du_id, car.du_tuning_id, du_conn_point, 
            susp_rest_len, roll_influence, radius, is_front);

    var wheel_cache = {
        // output cache
        trans: new Float32Array(3),
        quat: new Float32Array(4),

        // input cache
        du_trans: _du_vec3(0, 0, 0),
        du_quat: _du_quat4(0, 0, 0, 1)
    }
    // array index will be wheel num
    car.wheels_cache.push(wheel_cache);
}

function add_boat_bob(hull_body_id, conn_point, update_tranform) {

    var boat = get_boat(hull_body_id);

    var du_conn_point = _du_vec3(conn_point[0], conn_point[1], conn_point[2]);

    _du_boat_add_bob(boat.du_id, du_conn_point);

    if (update_tranform) {
        var bob_cache = {
            // output cache
            trans: new Float32Array(3),
            quat: new Float32Array(4),

            // input cache
            du_trans: _du_vec3(0, 0, 0),
            du_quat: _du_quat4(0, 0, 0, 1)
        }
        // array index will be bob num
        boat.bobs_cache.push(bob_cache);
    }
}

function add_floater_bob(floater_body_id, conn_point, update_tranform) {

    var floater = get_floater(floater_body_id);

    var du_conn_point = _du_vec3(conn_point[0], conn_point[1], conn_point[2]);

    _du_floating_body_add_bob(floater.du_id, du_conn_point);

    if (update_tranform) {
        var bob_cache = {
            // output cache
            trans: new Float32Array(3),
            quat: new Float32Array(4),

            // input cache
            du_trans: _du_vec3(0, 0, 0),
            du_quat: _du_quat4(0, 0, 0, 1)
        }
        // array index will be bob num
        floater.bobs_cache.push(bob_cache);
    }
}

function append_character(character_body_id, angle, height,
                          walk_speed, run_speed, step_height,
                          jump_strength, waterline,
                          coll_group, coll_mask) {
    var du_character_id = get_du_body_id(character_body_id);
    var char_body       = active_world().bodies[character_body_id];
    var coll_mask       = char_body.collision_mask;
    var coll_group      = char_body.collision_group;
    var du_character    = _du_create_character(du_character_id, angle, height,
                                             walk_speed, run_speed,
                                             step_height, jump_strength,
                                             waterline, coll_group, coll_mask);

    var character = {
        du_id: du_character,
    }

    active_world().characters[character_body_id] = character;
    _du_add_action(du_character);

    // set water if any
    var water = active_world().water;
    if (water) {
        _du_character_set_water(du_character, water.du_id);
        for (var i = 0; i < water.dist_arrays.length; i++)
            // if there is dynamic water setup it's wrapper
            if (water.dist_arrays[i])
                _du_character_set_water_wrapper_ind(du_character, i);
    }
}

function set_character_move_dir(body_id, forward, side) {
    var world = active_world();
    var character = world.characters[body_id].du_id;

    var body = world.bodies[body_id];

    _du_set_character_move_direction(character, side, 0, forward);
}

function set_character_move_type(body_id, type) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_move_type(character, type);
}

function set_character_walk_velocity(body_id, velocity) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_walk_velocity(character, velocity);
}

function set_character_run_velocity(body_id, velocity) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_run_velocity(character, velocity);
}

function set_character_fly_velocity(body_id, velocity) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_fly_velocity(character, velocity);
}

function character_jump(body_id) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_character_jump(character);
}

function set_character_rotation(body_id, angle_h, angle_v) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_rotation(character, angle_h, angle_v);
}

function set_character_hor_rotation(body_id, angle) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_vert_rotation(character, angle);
}

function set_character_vert_rotation(body_id, angle) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_set_character_hor_rotation(character, angle);
}

function character_rotation_increment(body_id, h_angle, v_angle) {
    var world = active_world();
    var character = world.characters[body_id].du_id;
    _du_character_rotation_inc(character, h_angle, v_angle);
}

function append_collision_test(pairs, need_payload) {
    var world = active_world();
    var tests = world.collision_tests;

    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];

        var is_pair_existed = false;
        for (var j = 0; j < tests.length; j++)
            if (tests[j].body_id_a === pair[0] && tests[j].body_id_b === pair[1]) {
                is_pair_existed = true;
                break;
            }
        if (is_pair_existed)
            continue;

        var test = {
            body_id_a: pair[0],
            body_id_b: pair[1],
            du_body_a: get_du_body_id(pair[0]),
            du_body_b: get_du_body_id(pair[1]),
            last_result: null,
            //last_cpoint: new Float32Array(3),
            need_payload: need_payload
        }

        add_collision_result(test.du_body_a, test.du_body_b);
        tests.push(test);
    }
}

function add_collision_result(du_body_a, du_body_b) {
    var world = active_world();
    var results = active_world().collision_results;

    results.array = _du_add_collision_result(results.array, results.size,
                                             du_body_a, du_body_b);

    results.size += 1;
}

function remove_collision_test(pairs) {
    var world = active_world();
    var tests = world.collision_tests;

    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];

        for (var j = 0; j < tests.length; j++) {
            var test = tests[j];
            if (test.body_id_a === pair[0] && test.body_id_b === pair[1]) {
                remove_collision_result(test.du_body_a, test.du_body_b);
                tests.splice(j, 1);
                j--;
            }
        }
    }
}

function remove_collision_result(du_body_a, du_body_b) {
    var world = active_world();
    var results = world.collision_results;

    results.array = _du_remove_collision_result(results.array, results.size,
                                                du_body_a, du_body_b);
    results.size -= 1;
}

function apply_collision_impulse_test(body_id) {
    var world = active_world();
    var body = world.bodies[body_id];
    if (body) {
        body.col_imp_test = true;
        body.col_imp_test_last_result = -1;
    } else
        throw "Wrong body ID";
}

function clear_collision_impulse_test(body_id) {
    var world = active_world();
    var body = world.bodies[body_id];
    if (body)
        body.col_imp_test = false;
    else
        throw "Wrong body ID";
}

function ray_test(body_id, from, to, local_coords, body_ids) {
    var world = active_world();

    if (body_ids && body_ids.length) {
        var id = ray_test_id(body_id, from, to, local_coords);

        // TODO: free memory before previous test will be overwrited
        var test = {
            body_id: body_id,

            from: from,
            to: to,
            local: local_coords,

            last_result: 1.0,

            // cache
            du_from: _du_vec3(from[0], from[1], from[2]),
            du_to: _du_vec3(to[0], to[1], to[2]),
            du_body_a: get_du_body_id(body_id),
            du_body_b_arr: _du_alloc_body_array(body_ids.length),
            du_body_b_num: body_ids.length,
            du_body_b_hit_ptr: _du_alloc_body_id_pointer()
        }

        for (var i = 0; i < body_ids.length; i++) {
            var body_id_b = body_ids[i];
            _du_store_body(test.du_body_b_arr, get_du_body_id(body_id_b), i);
        }

        world.ray_tests[id] = test;
    } else if (from && to) {
        var id = ray_test_id(body_id, from, to, local_coords);
        delete world.ray_tests[id];
    } else if (body_id) {
        // no from/to, delete all tests matching body_id
        for (var id in world.ray_tests) {
            var test = world.ray_tests[id];
            if (test.body_id == body_id)
                delete world.ray_tests[id];
        }
    } else
        throw "Wrong ray_test params";
}

function ray_test_id(body_id, from, to, local_coords) {
    var id = String(body_id) + array_stringify(from) + array_stringify(to) + 
            String(local_coords);
    return id;
}

function append_water(water_level) {

    world = active_world();

    if (world.water)
        return;

    var du_water_id = _du_create_water(water_level)

    var water = {
        du_id: du_water_id,
        dist_arrays: []
    }

    world.water = water;

    // if there are allready floaters, boats or characters - send water object
    for (var floater_body_id in world.floaters) {
        var floater = world.floaters[floater_body_id];
        _du_floater_set_water(floater.du_id, du_water_id);
    }
    for (var boat_body_id in world.boats) {
        var boat = world.boats[boat_body_id];
        _du_boat_set_water(boat.du_id, du_water_id);
    }
    for (var character_body_id in world.characters) {
        var character = world.characters[character_body_id];
        _du_character_set_water(character.du_id, du_water_id);
    }
}

function add_water_wrapper(dynamics_info, size_x, size_y, center_x, center_y,
                      max_shore_dist, waves_height, waves_length,
                      array_width, shore_dist_array) {

    world = active_world();
    if (!world.water)
        return;

    var dst_noise_scale0  = dynamics_info["dst_noise_scale0"];
    var dst_noise_scale1  = dynamics_info["dst_noise_scale1"];
    var dst_noise_freq0   = dynamics_info["dst_noise_freq0"];
    var dst_noise_freq1   = dynamics_info["dst_noise_freq1"];
    var dir_min_shore_fac = dynamics_info["dir_min_shore_fac"];
    var dir_freq          = dynamics_info["dir_freq"];
    var dir_noise_scale   = dynamics_info["dir_noise_scale"];
    var dir_noise_freq    = dynamics_info["dir_noise_freq"];
    var dir_min_noise_fac = dynamics_info["dir_min_noise_fac"];
    var dst_min_fac       = dynamics_info["dst_min_fac"];
    var waves_hor_fac     = dynamics_info["waves_hor_fac"];

    if (shore_dist_array) {

        var arr_len = shore_dist_array.length;

        if (!arr_len)
            var dist_arr = null;
        else {
            var dist_arr = _du_alloc_float_array(arr_len);
            HEAPF32.set(shore_dist_array, dist_arr >> 2);
        }
    } else
        var dist_arr = null;

    world.water.dist_arrays.push(dist_arr);

    water_du_id = world.water.du_id;

    _du_add_water_wrapper(water_du_id, dst_noise_scale0, dst_noise_scale1,
                          dst_noise_freq0, dst_noise_freq1, dir_min_shore_fac,
                          dir_freq, dir_noise_scale, dir_noise_freq,
                          dir_min_noise_fac, dst_min_fac, waves_hor_fac,
                          size_x, size_y, center_x, center_y, max_shore_dist,
                          waves_height, waves_length, array_width,
                          dist_arr);

    if (dist_arr) {
        // if there are floating objects exist and current water is dynamic
        // - set water wrapper index to the current one
        var ind = world.water.dist_arrays.length - 1;

        for (var floater_body_id in world.floaters) {
            var floater = world.floaters[floater_body_id];
            _du_floater_set_water_wrapper_ind(floater.du_id, ind);
        }
        for (var boat_body_id in world.boats) {
            var boat = world.boats[boat_body_id];
            _du_boat_set_water_wrapper_ind(boat.du_id, ind);
        }
        for (var character_body_id in world.characters) {
            var character = world.characters[character_body_id];
            _du_character_set_water_wrapper_ind(character.du_id, ind);
        }
    }
}

function set_water_time(time) {
    var water = active_world().water;
    if (!water) {
        console.error("No water added for physics world");
        return null;
    }
    _du_set_water_time(water.du_id, time);
}

function array_stringify(array) {

    var out = []
    for (var i = 0; i < array.length; i++)
        out.push(array[i]);

    return JSON.stringify(out);
}

function enable_simulation(body_id) {
    var world = active_world();

    var body = world.bodies[body_id];
    if (!body)
        throw "Wrong body ID";

    body.simulated = true;

    // restore coords from the cache
    set_transform(body_id, body.trans, body.quat);

    _du_add_body(body.du_id, body.collision_group, body.collision_mask);

    var du_action_id = find_du_action_id(world, body_id);
    if (du_action_id)
        _du_add_action(du_action_id);
}

function find_du_action_id(world, body_id) {
    if (world.cars[body_id])
        return world.cars[body_id].du_id;
    else if (world.boats[body_id])
        return world.boats[body_id].du_id;
    else if (world.floaters[body_id])
        return world.floaters[body_id].du_id;
    else if (world.characters[body_id])
        return world.characters[body_id].du_id;
    else
        return null;
}

function disable_simulation(body_id) {
    var world = active_world();

    var body = world.bodies[body_id];
    if (!body)
        throw "Wrong body ID";

    body.simulated = false;

    var du_action_id = find_du_action_id(world, body_id);
    if (du_action_id)
        _du_remove_action(du_action_id);

    _du_remove_body(body.du_id);
}

function activate(body_id) {
    var du_body_id = get_du_body_id(body_id);
    _du_activate(du_body_id);
}

/**
 * @param [quat=null] Rotation quaternion
 */
function set_transform(body_id, trans, quat) {
    var world = active_world();

    var body = world.bodies[body_id];
    if (!body)
        throw "Wrong body ID";

    var tx = trans[0];
    var ty = trans[1];
    var tz = trans[2];

    body.trans[0] = tx;
    body.trans[1] = ty;
    body.trans[2] = tz;

    _du_set_trans(body.du_id, tx, ty, tz);

    var qx = quat[0];
    var qy = quat[1];
    var qz = quat[2];
    var qw = quat[3];

    body.quat[0] = qx;
    body.quat[1] = qy;
    body.quat[2] = qz;
    body.quat[3] = qw;

    if (world.characters[body_id])
        set_character_rotation_quat(body_id, quat);
    else 
        _du_set_quat(body.du_id, qx, qy, qz, qw);
}

function set_character_rotation_quat(body_id, quat) {

    var z_dir = _vec3_tmp;
    z_dir[0] = 0;
    z_dir[1] = 0;
    z_dir[2] = 1;
    quat4_multiply_vec3(quat, z_dir);

    // project to XZ plane
    var proj = _vec3_tmp2
    proj[0] = z_dir[0];
    proj[1] = 0;
    proj[2] = z_dir[2];
    vec3_normalize(proj);

    // vertical plane
    var cos_v = proj[0]*z_dir[0] + proj[2]*z_dir[2];
    var sign_v = z_dir[1] < 0? 1: -1;

    // Z axis is positive direction
    var defdir = _vec3_tmp;
    defdir[0] = 0;
    defdir[1] = 0;
    defdir[2] = 1;

    // horizontal plane (dot product)
    var cos_h = proj[2] * defdir[2];
    // horizontal angle sign is a vertical part of cross cross(proj, defdir)
    var sign_h = (-proj[0] * defdir[2]) > 0? -1: 1;

    var angle_h  = Math.acos(cos_h) * sign_h;
    var angle_v  = Math.acos(cos_v) * sign_v;

    set_character_rotation(body_id, angle_h, angle_v)
}

function vec3_normalize(vec) {
    var x = vec[0], y = vec[1], z = vec[2],
        len = Math.sqrt(x * x + y * y + z * z);

    if (!len) {
        vec[0] = 0;
        vec[1] = 0;
        vec[2] = 0;
    } else if (len !== 1) {
        len = 1 / len;
        vec[0] = x * len;
        vec[1] = y * len;
        vec[2] = z * len;
    }
}

function quat4_multiply_vec3 (quat, vec) {
    var x = vec[0], y = vec[1], z = vec[2],
        qx = quat[0], qy = quat[1], qz = quat[2], qw = quat[3],

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    vec[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    vec[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    vec[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
};

function set_linear_velocity(body_id, vx, vy, vz) {
    var du_body_id = get_du_body_id(body_id);
    _du_set_linear_velocity(du_body_id, vx, vy, vz);
}

function apply_central_force(body_id, fx, fy, fz) {
    var world = active_world();
    var body = world.bodies[body_id];

    body.applied_central_force = body.applied_central_force ||
            new Float32Array(3);

    body.applied_central_force[0] = fx;
    body.applied_central_force[1] = fy;
    body.applied_central_force[2] = fz;

    //var du_body_id = get_du_body_id(body_id);
    //_du_apply_central_force(du_body_id, fx, fy, fz);
}

function apply_torque(body_id, tx, ty, tz) {
    var world = active_world();
    var body = world.bodies[body_id];

    body.applied_torque = body.applied_torque ||
            new Float32Array(3);

    body.applied_torque[0] = tx;
    body.applied_torque[1] = ty;
    body.applied_torque[2] = tz;
}

function update_car_controls(chassis_body_id, engine_force, brake_force, 
        steering_value) {

    var car = get_car(chassis_body_id);
    _du_update_vehicle_controls(car.du_id, engine_force, brake_force, 
            steering_value);
}

function update_boat_controls(hull_body_id, engine_force, brake_force, 
        steering_value) {

    var boat = get_boat(hull_body_id);
    _du_update_boat_controls(boat.du_id, engine_force, brake_force, 
            steering_value);
}

function set_gravity(body_id, gravity) {
    var du_body_id = get_du_body_id(body_id);
    _du_set_gravity(du_body_id, gravity);
}

function set_damping(body_id, damping, rotation_damping) {
    var du_body_id = get_du_body_id(body_id);
    _du_set_damping(du_body_id, damping, rotation_damping);
}

function init_worker_environment() {
    if (typeof importScripts === "function") {

        self.console = {};
        console.log = function() {
            var msg = [m_ipc.IN_LOG];
            for (var i = 0; i < arguments.length; i++)
                msg.push(arguments[i]);

            // pass message cache
            self.postMessage(msg);
        }
        console.error = function() {
            var msg = [m_ipc.IN_ERROR];
            for (var i = 0; i < arguments.length; i++)
                msg.push(arguments[i]);

            // pass message cache
            self.postMessage(msg);
        }
        fbmsg = function() {
            var msg = [m_ipc.IN_FBMSG];
            for (var i = 0; i < arguments.length; i++)
                msg.push(arguments[i]);

            // pass message cache
            self.postMessage(msg);
        }

    } else
        throw "Worker environment not found";

    m_ipc.init(self, process_message);
}

function init_engine(init_time, max_fps) {
    if (!self["performance"])
        self["performance"] = {};

    if (!self["performance"]["now"]) {
        self["performance"]["now"] = function() {
            return Date.now() - init_time;
        }
    }

    _update_interval = 1/max_fps;

    frame();
}

function frame() {
    self.setTimeout(frame, 300 * _update_interval);

    // float sec
    var abstime = performance.now() / 1000;

    if (!_last_abs_time)
        _last_abs_time = abstime;

    var delta = abstime - _last_abs_time;
    
    if (_do_simulation)
        update_worlds(_worlds, abstime, delta);

    _last_abs_time = abstime;
}


function update_worlds(worlds, time, delta) {
    for (var world_id in worlds) {

        var world = worlds[world_id];

        var steps = _du_pre_simulation(world.du_id, delta, 3, _update_interval);

        if (steps) {
            for (var i = 0; i < steps; i++) {
                var sim_time = _du_calc_sim_time(world.du_id, time, i, steps);

                pre_tick_callback(world, sim_time);

                _du_single_step_simulation(world.du_id, 0);

                tick_callback(world, sim_time);
            }
        }

        _du_post_simulation(world.du_id);
    }
}

/**
 * Executed from bindings.cpp
 */
function pre_tick_callback(world, time) {
    // apply central force before simulation if needed
    for (var body_id in world.bodies) {
        var body = world.bodies[body_id];

        if (body.applied_central_force) {
            var fx = body.applied_central_force[0];
            var fy = body.applied_central_force[1];
            var fz = body.applied_central_force[2];

            _du_apply_central_force(body.du_id, fx, fy, fz);
        }

        if (body.applied_torque) {
            var tx = body.applied_torque[0];
            var ty = body.applied_torque[1];
            var tz = body.applied_torque[2];

            _du_apply_torque(body.du_id, tx, ty, tz);
        }
    }
}

/**
 * Executed from bindings.cpp
 */
function tick_callback(world, time) {

    for (var body_id in world.bodies) {
        var body = world.bodies[body_id];

        if (body.dynamic && body.simulated) {
            if (world.characters[body_id]) {
                var character = world.characters[body_id].du_id;
                _du_get_character_trans_quat(character, body.du_id,
                                            body.du_trans, body.du_quat,
                                            body.du_linvel, body.du_angvel);

            } else {
                _du_get_interp_data(body.du_id, body.du_trans,
                        body.du_quat, body.du_linvel, body.du_angvel);

            }

            if (body_check_prepare_interp_data(body)) {

                var msg_cache = m_ipc.get_msg_cache(m_ipc.IN_TRANSFORM);

                msg_cache["msg_id"]  = m_ipc.IN_TRANSFORM;
                msg_cache["body_id"] = body_id;
                msg_cache["time"]    = time;
                msg_cache["trans"]   = body.trans;
                msg_cache["quat"]    = body.quat;
                msg_cache["linvel"]  = body.linvel;
                msg_cache["angvel"]  = body.angvel;

                m_ipc.post_msg(m_ipc.IN_TRANSFORM, msg_cache);
            }

            if (body.col_imp_test) {
                var result = _du_check_collision_impulse(body.du_id);

                if (result != body.col_imp_test_last_result)
                    m_ipc.post_msg(m_ipc.IN_COLLISION_IMPULSE, body_id, result);

                body.col_imp_test_last_result = result;
            }
        }
    }
    for (var chassis_body_id in world.cars) {
        var car = world.cars[chassis_body_id];
        var wheels_cache = car.wheels_cache;
        for (var i = 0; i < wheels_cache.length; i++) {
            var cache = wheels_cache[i];
            _du_get_vehicle_wheel_trans_quat(car.du_id, i, cache.du_trans, cache.du_quat);

            if (body_check_prepare_output(cache)) {

                var msg_cache = m_ipc.get_msg_cache(m_ipc.IN_PROP_OFFSET);

                msg_cache["msg_id"]               = m_ipc.IN_PROP_OFFSET;
                msg_cache["chassis_hull_body_id"] = chassis_body_id;
                msg_cache["prop_ind"]             = i;
                msg_cache["trans"]                = cache.trans;
                msg_cache["quat"]                 = cache.quat;

                m_ipc.post_msg(m_ipc.IN_PROP_OFFSET, msg_cache);
            }
        }

        // NOTE: consider using cache
        var speed = _du_get_vehicle_speed(car.du_id);
        m_ipc.post_msg(m_ipc.IN_VEHICLE_SPEED, chassis_body_id, speed);
    }
    for (var hull_body_id in world.boats) {

        var boat = world.boats[hull_body_id];

        var bobs_cache = boat.bobs_cache;
        for (var i = 0; i < bobs_cache.length; i++) {
            var cache = bobs_cache[i];
            _du_get_boat_bob_trans_quat(boat.du_id, i, cache.du_trans, cache.du_quat);
            if (body_check_prepare_output(cache)) {

                var msg_cache = m_ipc.get_msg_cache(m_ipc.IN_PROP_OFFSET);

                msg_cache["msg_id"]               = m_ipc.IN_PROP_OFFSET;
                msg_cache["chassis_hull_body_id"] = hull_body_id;
                msg_cache["prop_ind"]             = i;
                msg_cache["trans"]                = cache.trans;
                msg_cache["quat"]                 = cache.quat;

                m_ipc.post_msg(m_ipc.IN_PROP_OFFSET, msg_cache);
            }
        }
        var speed = _du_get_boat_speed(boat.du_id);
        m_ipc.post_msg(m_ipc.IN_VEHICLE_SPEED, hull_body_id, speed);
    }
    for (var floater_body_id in world.floaters) {

        var floater = world.floaters[floater_body_id];
        var bobs_cache = floater.bobs_cache;
        for (var i = 0; i < bobs_cache.length; i++) {
            var cache = bobs_cache[i];
            _du_get_floater_bob_trans_quat(floater.du_id, i, cache.du_trans,
                                           cache.du_quat);
            if (body_check_prepare_output(cache))
                m_ipc.post_msg(m_ipc.IN_FLOATER_BOB_TRANSFORM, floater_body_id, i,
                        cache.trans, cache.quat);
        }
    }

    var results = world.collision_results.array;
    var arr_size = world.collision_results.size;

    if (results)
        _du_check_collisions(results, arr_size);

    for (var i = 0; i < world.collision_tests.length; i++) {
        var test = world.collision_tests[i];

        var du_body_a = test.du_body_a;
        var du_body_b = test.du_body_b;

        var result = _du_get_collision_result(results, arr_size, du_body_a, du_body_b, _du_vec3_tmp);

        var body_id_a = test.body_id_a;
        var body_id_b = test.body_id_b;
        var cpoint = _vec3_tmp;

        if (test.need_payload && result) {
            cpoint[0] = HEAPF32[(_du_vec3_tmp >> 2)];
            cpoint[1] = HEAPF32[(_du_vec3_tmp >> 2) + 1];
            cpoint[2] = HEAPF32[(_du_vec3_tmp >> 2) + 2];
        } else {
            cpoint[0] = 0;
            cpoint[1] = 0;
            cpoint[2] = 0;
        }

        if (need_collision_result_update(test, result, cpoint)) {
            var msg_cache = m_ipc.get_msg_cache(m_ipc.IN_COLLISION);

            msg_cache["msg_id"]     = m_ipc.IN_COLLISION;
            msg_cache["body_id_a"]  = body_id_a;
            msg_cache["body_id_b"]  = body_id_b;
            msg_cache["result"]     = result;
            msg_cache["coll_point"] = cpoint;

            m_ipc.post_msg(m_ipc.IN_COLLISION, msg_cache);
        }

        test.last_result = result;
        // NOTE: Bad garbage collection behaviour.
        // Temporary disabled every frame collision point update
        //test.last_cpoint[0] = cpoint[0];
        //test.last_cpoint[1] = cpoint[1];
        //test.last_cpoint[2] = cpoint[2];
    }

    for (var id in world.ray_tests) {

        var test = world.ray_tests[id];

        var body_id_a = test.body_id;
        var du_body_a = world.bodies[body_id_a].du_id;
        var du_from = test.du_from;
        var du_to = test.du_to;
        var local = test.local;

        var du_body_b_arr = test.du_body_b_arr;
        var du_body_b_num = test.du_body_b_num;

        var du_body_b_hit_ptr = test.du_body_b_hit_ptr;

        var cur_result = _du_check_ray_hit(du_body_a, du_from, du_to,
                local, du_body_b_arr, du_body_b_num, du_body_b_hit_ptr);

        // report if something has changed
        if (test.last_result !== cur_result) {

            if (cur_result != 1.0) {
                var du_body_b_hit = _du_get_body_id_by_pointer(du_body_b_hit_ptr);
                var body_id_b_hit = get_body_id(du_body_b_hit);
            } else
                var body_id_b_hit = -1;

            var msg_cache = m_ipc.get_msg_cache(m_ipc.IN_RAY_HIT);

            msg_cache["msg_id"]        = m_ipc.IN_RAY_HIT;
            msg_cache["body_id"]       = test.body_id;
            msg_cache["from"]          = test.from;
            msg_cache["to"]            = test.to;
            msg_cache["local"]         = test.local;
            msg_cache["body_id_b_hit"] = body_id_b_hit;
            msg_cache["cur_result"]    = cur_result;

            m_ipc.post_msg(m_ipc.IN_RAY_HIT, msg_cache);

            test.last_result = cur_result;
        }
    }
}

function need_collision_result_update(test, result, cpoint) {
    return result != test.last_result; //|| cpoint[0] != test.last_cpoint[0] ||
                                      //   cpoint[1] != test.last_cpoint[1] ||
                                      //   cpoint[2] != test.last_cpoint[2];
}

function body_check_prepare_output(body) {

    var du_trans_x = HEAPF32[body.du_trans / 4];
    var du_trans_y = HEAPF32[body.du_trans / 4 + 1];
    var du_trans_z = HEAPF32[body.du_trans / 4 + 2];

    var du_quat_x = HEAPF32[body.du_quat / 4];
    var du_quat_y = HEAPF32[body.du_quat / 4 + 1];
    var du_quat_z = HEAPF32[body.du_quat / 4 + 2];
    var du_quat_w = HEAPF32[body.du_quat / 4 + 3];

    if (    body.trans[0] == du_trans_x &&
            body.trans[1] == du_trans_y &&
            body.trans[2] == du_trans_z &&
            body.quat[0]  == du_quat_x  &&
            body.quat[1]  == du_quat_y  &&
            body.quat[2]  == du_quat_z  &&
            body.quat[3]  == du_quat_w)
        return false;

    body.trans[0] = du_trans_x;
    body.trans[1] = du_trans_y;
    body.trans[2] = du_trans_z;

    body.quat[0] = du_quat_x;
    body.quat[1] = du_quat_y;
    body.quat[2] = du_quat_z;
    body.quat[3] = du_quat_w;

    return true;
}

/**
 * Check if coord changed and update
 */
function body_check_prepare_interp_data(body) {

    var du_linvel_x = HEAPF32[body.du_linvel / 4];
    var du_linvel_y = HEAPF32[body.du_linvel / 4 + 1];
    var du_linvel_z = HEAPF32[body.du_linvel / 4 + 2];

    var du_angvel_x = HEAPF32[body.du_angvel / 4];
    var du_angvel_y = HEAPF32[body.du_angvel / 4 + 1];
    var du_angvel_z = HEAPF32[body.du_angvel / 4 + 2];

    if (!body_check_prepare_output(body) &&
            body.linvel[0] == du_linvel_x &&
            body.linvel[1] == du_linvel_y &&
            body.linvel[2] == du_linvel_z &&
            body.angvel[0] == du_angvel_x && 
            body.angvel[1] == du_angvel_y &&
            body.angvel[2] == du_angvel_z)
        return false;

    body.linvel[0] = du_linvel_x;
    body.linvel[1] = du_linvel_y;
    body.linvel[2] = du_linvel_z;

    body.angvel[0] = du_angvel_x;
    body.angvel[1] = du_angvel_y;
    body.angvel[2] = du_angvel_z;

    return true;
}

function cleanup() {
    for (var world_id in _worlds) {
        var world = _worlds[world_id];

        _du_cleanup_world(world.du_id);
    }

    _worlds = {};
    _active_world_id = null;
}

/**
 * Print world and physics stat
 */
function debug() {
    console.log("active_world", _active_world_id);

    var worlds_num = 0;
    var bodies_num = 0;
    var cons_num = 0;
    var cars_num = 0;
    var boats_num = 0;
    var characters_num = 0;
    var collision_tests_num = 0;
    var ray_tests_num = 0;
    var floaters_num = 0;

    for (var w in _worlds) {
        var world = _worlds[w];

        worlds_num++;
        bodies_num += obj_len(world.bodies);
        cons_num += obj_len(world.constraints);
        cars_num += obj_len(world.cars);
        boats_num += obj_len(world.boats);
        characters_num += obj_len(world.characters);
        collision_tests_num += world.collision_tests.length;
        ray_tests_num += obj_len(world.ray_tests);
        floaters_num += obj_len(world.floaters);

        console.log("world " + w, world);
    }

    console.log("worlds: " + String(worlds_num));
    console.log("bodies: " + String(bodies_num));
    console.log("constraints: " + String(cons_num));
    console.log("cars: " + String(cars_num));
    console.log("boats: " + String(boats_num));
    console.log("characters: " + String(characters_num));
    console.log("collision tests: " + String(collision_tests_num));
    console.log("ray tests: " + String(ray_tests_num));
    console.log("floaters: " + String(floaters_num));
}

function obj_len(obj) {
    var len = 0;
    for (var key in obj)
        len++;
    return len;
}

function process_message(msg_id, msg) {
    switch (msg_id) {
    case m_ipc.OUT_INIT:
        init_engine(msg[1], msg[2]);
        break;
    case m_ipc.OUT_PING:
        m_ipc.post_msg(m_ipc.IN_PING, msg[1]);
        break;
    case m_ipc.OUT_APPEND_WORLD:
        append_world(msg[1]);
        break;
    case m_ipc.OUT_SET_ACTIVE_WORLD:
        set_active_world(msg[1]);
        break;
    case m_ipc.OUT_PAUSE:
        _do_simulation = false;
        break;
    case m_ipc.OUT_RESUME:
        _do_simulation = true;
        break;
    case m_ipc.OUT_APPEND_STATIC_MESH_BODY:
        append_static_mesh_body.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_APPEND_GHOST_MESH_BODY:
        append_ghost_mesh_body.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_APPEND_BOUNDING_BODY:
        append_bounding_body.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_APPEND_CONSTRAINT:
        append_constraint.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_REMOVE_CONSTRAINT:
        remove_constraint(msg[1]);
        break;
    case m_ipc.OUT_APPEND_CAR:
        append_car(msg[1], msg[2], msg[3], msg[4], msg[5], msg[6]);
        break;
    case m_ipc.OUT_APPEND_BOAT:
        append_boat(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_APPEND_FLOATER:
        append_floater(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_ADD_CAR_WHEEL:
        add_car_wheel.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_ADD_BOAT_BOB:
        add_boat_bob.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_ADD_FLOATER_BOB:
        add_floater_bob.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_APPEND_CHARACTER:
        append_character.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_APPEND_COLLISION_TEST:
        append_collision_test(msg[1], msg[2]);
        break;
    case m_ipc.OUT_REMOVE_COLLISION_TEST:
        remove_collision_test(msg[1]);
        break;
    case m_ipc.OUT_APPLY_COLLISION_IMPULSE_TEST:
        apply_collision_impulse_test(msg[1]);
        break;
    case m_ipc.OUT_CLEAR_COLLISION_IMPULSE_TEST:
        clear_collision_impulse_test(msg[1]);
        break;
    case m_ipc.OUT_RAY_TEST:
        ray_test(msg[1], msg[2], msg[3], msg[4], msg[5]);
        break;
    case m_ipc.OUT_ENABLE_SIMULATION:
        enable_simulation(msg[1]);
        break;
    case m_ipc.OUT_DISABLE_SIMULATION:
        disable_simulation(msg[1]);
        break;
    case m_ipc.OUT_ACTIVATE:
        activate(msg[1]);
        break;
    case m_ipc.OUT_SET_TRANSFORM:
        set_transform(msg["body_id"], msg["trans"], msg["quat"]);
        break;
    case m_ipc.OUT_SET_LINEAR_VELOCITY:
        set_linear_velocity(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_APPLY_CENTRAL_FORCE:
        apply_central_force(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_APPLY_TORQUE:
        apply_torque(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_SET_CHARACTER_MOVE_DIR:
        set_character_move_dir(msg[1], msg[2], msg[3]);
        break;
    case m_ipc.OUT_SET_CHARACTER_MOVE_TYPE:
        set_character_move_type(msg[1], msg[2]);
        break;
    case m_ipc.OUT_SET_CHARACTER_WALK_VELOCITY:
        set_character_walk_velocity(msg[1], msg[2]);
        break;
    case m_ipc.OUT_SET_CHARACTER_RUN_VELOCITY:
        set_character_run_velocity(msg[1], msg[2]);
        break;
    case m_ipc.OUT_SET_CHARACTER_FLY_VELOCITY:
        set_character_fly_velocity(msg[1], msg[2]);
        break;
    case m_ipc.OUT_CHARACTER_JUMP:
        character_jump(msg[1]);
        break;
    case m_ipc.OUT_SET_CHARACTER_ROTATION:
        set_character_rotation(msg[1], msg[2], msg[3]);
        break;
    case m_ipc.OUT_SET_CHARACTER_HOR_ROTATION:
        set_character_hor_rotation(msg[1], msg[2]);
        break;
    case m_ipc.OUT_SET_CHARACTER_VERT_ROTATION:
        set_character_vert_rotation(msg[1], msg[2]);
        break;
    case m_ipc.OUT_CHARACTER_ROTATION_INCREMENT:
        character_rotation_increment(msg[1], msg[2], msg[3]);
        break;
    case m_ipc.OUT_UPDATE_CAR_CONTROLS:
        update_car_controls(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_UPDATE_BOAT_CONTROLS:
        update_boat_controls(msg[1], msg[2], msg[3], msg[4]);
        break;
    case m_ipc.OUT_SET_GRAVITY:
        set_gravity(msg[1], msg[2]);
        break;
    case m_ipc.OUT_SET_DAMPING:
        set_damping(msg[1], msg[2], msg[3]);
        break;
    case m_ipc.OUT_APPEND_WATER:
        append_water.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_ADD_WATER_WRAPPER:
        add_water_wrapper.apply(this, msg.slice(1));
        break;
    case m_ipc.OUT_SET_WATER_TIME:
        set_water_time(msg[1]);
        break;
    case m_ipc.OUT_CLEANUP:
        cleanup();
        break;
    case m_ipc.OUT_DEBUG:
        debug();
        break;
    default:
        throw "Unknown message " + msg_id;
        break;
    }
}

init_worker_environment();
